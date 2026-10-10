export * as Label from "./label"

import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"
import { Label } from "@opencode-ai/schema/label"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { LabelTable, SessionLabelTable } from "./label/sql"
import { SessionTable } from "./session/sql"
import { SessionSchema } from "./session/schema"

/** Maximum label name length, so names stay readable in the session list UI. */
export const MAX_NAME_LENGTH = 64

export const ID = Label.ID
export type ID = Label.ID

export const Info = Label.Info
export type Info = Label.Info

export const CreateInput = Label.CreateInput
export type CreateInput = Label.CreateInput

export const ListInput = Label.ListInput
export type ListInput = Label.ListInput

export const UpdateInput = Label.UpdateInput
export type UpdateInput = Label.UpdateInput

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Label.NotFoundError", {
  id: Schema.String,
}) {
  override get message() {
    return `Label ${this.id} does not exist`
  }
}

export class InvalidNameError extends Schema.TaggedErrorClass<InvalidNameError>()("Label.InvalidNameError", {
  name: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return `Invalid label name "${this.name}": ${this.reason}`
  }
}

export class DuplicateNameError extends Schema.TaggedErrorClass<DuplicateNameError>()("Label.DuplicateNameError", {
  name: Schema.String,
}) {
  override get message() {
    return `A label named "${this.name}" already exists at this level`
  }
}

export class CycleError extends Schema.TaggedErrorClass<CycleError>()("Label.CycleError", {
  id: Schema.String,
  parentID: Schema.String,
}) {
  override get message() {
    return `Label ${this.id} cannot be moved under ${this.parentID} because it would create a cycle`
  }
}

export class SessionNotFoundError extends Schema.TaggedErrorClass<SessionNotFoundError>()(
  "Label.SessionNotFoundError",
  { sessionID: Schema.String },
) {
  override get message() {
    return `Session ${this.sessionID} does not exist`
  }
}

export interface AssignInput {
  readonly sessionID: SessionSchema.ID
  readonly labelID: ID
}

export interface Interface {
  readonly create: (input: CreateInput) => Effect.Effect<Info, NotFoundError | InvalidNameError | DuplicateNameError>
  readonly get: (id: ID) => Effect.Effect<Info, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<ReadonlyArray<Info>>
  readonly update: (
    id: ID,
    input: UpdateInput,
  ) => Effect.Effect<Info, NotFoundError | InvalidNameError | DuplicateNameError | CycleError>
  /**
   * Deletes a label and all of its descendants.
   * Returns the IDs of every deleted label so callers (e.g. session label
   * assignments) can clean up references to them.
   */
  readonly remove: (id: ID) => Effect.Effect<ReadonlyArray<ID>, NotFoundError>
  /**
   * Resolves a "/"-separated label path, such as "Coursework/Databases", to the IDs of
   * every matching label plus all labels nested beneath them. Names match case-insensitively,
   * and the path may start at any depth, so "Databases" matches every label with that name.
   */
  readonly resolvePath: (path: string) => Effect.Effect<ReadonlyArray<ID>>
  /** Attaches a label to a session. Assigning a label the session already has is a no-op. */
  readonly assign: (input: AssignInput) => Effect.Effect<void, NotFoundError | SessionNotFoundError>
  /** Detaches a label from a session. Removing a label the session does not have is a no-op. */
  readonly unassign: (input: AssignInput) => Effect.Effect<void>
  /** Lists the labels attached to a session, sorted by name. */
  readonly forSession: (sessionID: SessionSchema.ID) => Effect.Effect<ReadonlyArray<Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Label") {}

type Row = typeof LabelTable.$inferSelect

function fromRow(row: Row): Info {
  return {
    id: ID.make(row.id),
    name: row.name,
    parentID: row.parent_id ? ID.make(row.parent_id) : undefined,
    time: { created: row.time_created, updated: row.time_updated },
  }
}

/** Trims the name and rejects empty or overly long names. */
export function normalizeName(name: string): Effect.Effect<string, InvalidNameError> {
  const trimmed = name.trim()
  if (!trimmed) return Effect.fail(new InvalidNameError({ name, reason: "name cannot be empty" }))
  if (trimmed.length > MAX_NAME_LENGTH)
    return Effect.fail(
      new InvalidNameError({ name, reason: `name cannot be longer than ${MAX_NAME_LENGTH} characters` }),
    )
  return Effect.succeed(trimmed)
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const findRow = Effect.fnUntraced(function* (id: string) {
      return yield* db.select().from(LabelTable).where(eq(LabelTable.id, id)).get().pipe(Effect.orDie)
    })

    const requireRow = Effect.fnUntraced(function* (id: string) {
      const row = yield* findRow(id)
      if (!row) return yield* new NotFoundError({ id })
      return row
    })

    /** Sibling names are unique, case-insensitively, so the hierarchy stays unambiguous. */
    const ensureUniqueName = Effect.fnUntraced(function* (input: {
      name: string
      parentID: string | null
      exclude?: string
    }) {
      const existing = yield* db
        .select({ id: LabelTable.id })
        .from(LabelTable)
        .where(
          and(
            input.parentID === null ? isNull(LabelTable.parent_id) : eq(LabelTable.parent_id, input.parentID),
            sql`lower(${LabelTable.name}) = ${input.name.toLowerCase()}`,
            input.exclude ? ne(LabelTable.id, input.exclude) : undefined,
          ),
        )
        .get()
        .pipe(Effect.orDie)
      if (existing) return yield* new DuplicateNameError({ name: input.name })
    })

    /** Collects a label and every label nested beneath it, breadth first. */
    const subtree = Effect.fnUntraced(function* (id: string) {
      const ids = [id]
      let frontier = [id]
      while (frontier.length) {
        const children = yield* db
          .select({ id: LabelTable.id })
          .from(LabelTable)
          .where(inArray(LabelTable.parent_id, frontier))
          .all()
          .pipe(Effect.orDie)
        frontier = children.map((child) => child.id)
        ids.push(...frontier)
      }
      return ids
    })

    const create = Effect.fn("Label.create")(function* (input: CreateInput) {
      const name = yield* normalizeName(input.name)
      const parentID = input.parentID ?? null
      if (parentID !== null) yield* requireRow(parentID)
      yield* ensureUniqueName({ name, parentID })

      const row = yield* db
        .insert(LabelTable)
        .values({ id: ID.create(), name, parent_id: parentID })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return fromRow(row)
    })

    const get = Effect.fn("Label.get")(function* (id: ID) {
      return fromRow(yield* requireRow(id))
    })

    const list = Effect.fn("Label.list")(function* (input?: ListInput) {
      const where =
        input?.parentID === undefined
          ? undefined
          : input.parentID === null
            ? isNull(LabelTable.parent_id)
            : eq(LabelTable.parent_id, input.parentID)
      const rows = yield* db
        .select()
        .from(LabelTable)
        .where(where)
        .orderBy(asc(LabelTable.name), asc(LabelTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map(fromRow)
    })

    const update = Effect.fn("Label.update")(function* (id: ID, input: UpdateInput) {
      const current = yield* requireRow(id)
      const name = input.name === undefined ? current.name : yield* normalizeName(input.name)
      const parentID = input.parentID === undefined ? current.parent_id : input.parentID

      if (parentID !== null) {
        // A label cannot become its own ancestor: walk up from the new parent and make sure we never reach `id`.
        let cursor: string | null = parentID
        while (cursor !== null) {
          if (cursor === id) return yield* new CycleError({ id, parentID })
          cursor = (yield* requireRow(cursor)).parent_id
        }
      }

      if (name === current.name && parentID === current.parent_id) return fromRow(current)
      yield* ensureUniqueName({ name, parentID, exclude: id })

      const row = yield* db
        .update(LabelTable)
        .set({ name, parent_id: parentID })
        .where(eq(LabelTable.id, id))
        .returning()
        .get()
        .pipe(Effect.orDie)
      // The row can only disappear here if another caller deleted it between the read and the write.
      if (!row) return yield* new NotFoundError({ id })
      return fromRow(row)
    })

    const remove = Effect.fn("Label.remove")(function* (id: ID) {
      yield* requireRow(id)
      const ids = yield* subtree(id)
      // A single DELETE statement satisfies the self-referencing foreign key,
      // because SQLite checks it once the whole statement has run.
      yield* db.delete(LabelTable).where(inArray(LabelTable.id, ids)).run().pipe(Effect.orDie)
      return ids.map((value) => ID.make(value))
    })

    const resolvePath = Effect.fn("Label.resolvePath")(function* (path: string) {
      const segments = path
        .split("/")
        .map((segment) => segment.trim().toLowerCase())
        .filter(Boolean)
      if (!segments.length) return []

      // Label trees are small, so matching in memory is simpler than a recursive query per segment.
      const rows = yield* db
        .select({ id: LabelTable.id, name: LabelTable.name, parent_id: LabelTable.parent_id })
        .from(LabelTable)
        .all()
        .pipe(Effect.orDie)
      const byID = new Map(rows.map((row) => [row.id, row]))
      // Walk up from the label, matching the path from its last segment to its first.
      const matchesPath = (row: (typeof rows)[number]) => {
        let cursor: typeof row | undefined = row
        for (const segment of segments.toReversed()) {
          if (cursor?.name.toLowerCase() !== segment) return false
          cursor = cursor.parent_id ? byID.get(cursor.parent_id) : undefined
        }
        return true
      }

      const ids = new Set(rows.filter(matchesPath).map((row) => row.id))
      // Pull in descendants until no new labels are added.
      while (true) {
        const children = rows.filter((row) => row.parent_id && ids.has(row.parent_id) && !ids.has(row.id))
        if (!children.length) break
        children.forEach((row) => ids.add(row.id))
      }
      return [...ids].map((id) => ID.make(id))
    })

    const assign = Effect.fn("Label.assign")(function* (input: AssignInput) {
      yield* requireRow(input.labelID)
      const session = yield* db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      if (!session) return yield* new SessionNotFoundError({ sessionID: input.sessionID })
      yield* db
        .insert(SessionLabelTable)
        .values({ session_id: input.sessionID, label_id: input.labelID })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    const unassign = Effect.fn("Label.unassign")(function* (input: AssignInput) {
      yield* db
        .delete(SessionLabelTable)
        .where(and(eq(SessionLabelTable.session_id, input.sessionID), eq(SessionLabelTable.label_id, input.labelID)))
        .run()
        .pipe(Effect.orDie)
    })

    const forSession = Effect.fn("Label.forSession")(function* (sessionID: SessionSchema.ID) {
      const rows = yield* db
        .select({ label: LabelTable })
        .from(SessionLabelTable)
        .innerJoin(LabelTable, eq(LabelTable.id, SessionLabelTable.label_id))
        .where(eq(SessionLabelTable.session_id, sessionID))
        .orderBy(asc(LabelTable.name), asc(LabelTable.id))
        .all()
        .pipe(Effect.orDie)
      return rows.map((row) => fromRow(row.label))
    })

    return Service.of({ create, get, list, update, remove, resolvePath, assign, unassign, forSession })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node] })
