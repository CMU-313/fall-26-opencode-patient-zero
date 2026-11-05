import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import fc from "fast-check"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Label } from "@opencode-ai/core/label"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Label.node])))

// Label names: arbitrary unicode (which includes "/", the label path separator), plus the edges the service
// treats specially: surrounding whitespace that gets trimmed, names exactly at the 64-character limit, and
// realistic names that differ only by case. Blank or over-long names are rejected by design, so they are
// filtered out here rather than tested as moves or assignments.
const labelName = fc
  .oneof(
    // Short unicode names, including emoji, accents, and "/".
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 20 }),
    // Names exactly at the 64-character limit, the longest a label may be.
    fc.string({ unit: "grapheme-ascii", minLength: Label.MAX_NAME_LENGTH, maxLength: Label.MAX_NAME_LENGTH }),
    // Names wrapped in whitespace, which the service trims before saving.
    fc
      .tuple(
        fc.constantFrom(" ", "  ", "\t"),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom("", " ", "\n"),
      )
      .map(([before, name, after]) => before + name + after),
    // Realistic names from the interviews, including two that differ only by case and a path-like name.
    fc.constantFrom("Work", "work", "Coursework", "Coursework/Databases"),
  )
  // Blank names and names over the limit are rejected by create, so they cannot be moved or assigned.
  .filter((name) => name.trim().length > 0 && name.trim().length <= Label.MAX_NAME_LENGTH)

// Sibling names must be unique case-insensitively after trimming, so sets of labels that share a parent are
// generated with that same key to avoid DuplicateNameError masking the property under test.
const siblingNames = (minLength: number, maxLength: number) =>
  fc.uniqueArray(labelName, { minLength, maxLength, selector: (name) => name.trim().toLowerCase() })

// Every property run shares one database, so each run builds its labels under a fresh root label to keep
// generated names from colliding with labels left over from earlier runs.
const createRoot = Effect.gen(function* () {
  const labels = yield* Label.Service
  return yield* labels.create({ name: `run-${crypto.randomUUID()}` })
})

/** Inserts `count` sessions with fresh IDs so labels can be assigned to them across property runs. */
const createSessions = (count: number) =>
  Effect.gen(function* () {
    if (count === 0) return []
    const { db } = yield* Database.Service
    const projectID = ProjectV2.ID.make("prj_labels")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const ids = Array.from({ length: count }, () => SessionSchema.ID.make(`ses_${crypto.randomUUID()}`))
    yield* db
      .insert(SessionTable)
      .values(
        ids.map((id) => ({
          id,
          project_id: projectID,
          slug: id,
          directory: "/repo",
          title: id,
          version: "test",
          time_created: 1,
          time_updated: 1,
        })),
      )
      .run()
      .pipe(Effect.orDie)
    return ids
  })

/** Runs an Effect-based fast-check property against the test's Label and Database services. */
const assertProperty = <T, E>(
  arbitrary: fc.Arbitrary<T>,
  predicate: (value: T) => Effect.Effect<void, E, Label.Service | Database.Service>,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Label.Service | Database.Service>()
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arbitrary, (value) => predicate(value).pipe(Effect.runPromiseWith(context))),
        { numRuns: 50 },
      ),
    )
  })

describe("Label properties", () => {
  // R1: Adding a parent label to an existing label will not change that existing label's name.
  // Kind: invariant
  // Generators: two distinct sibling names for A and B, plus 0–3 children already nested under A, so the move
  // covers both leaf labels and labels that carry a subtree whose names must also survive untouched.
  it.effect("R1: moving a label under a parent keeps its name", () =>
    assertProperty(
      fc.record({
        // Names for label A (the label being moved) and label B (its new parent).
        names: siblingNames(2, 2),
        // 0 children covers moving a leaf label; 1–3 covers moving a label that carries a subtree.
        childNames: siblingNames(0, 3),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const root = yield* createRoot
          const a = yield* labels.create({ name: input.names[0], parentID: root.id })
          const b = yield* labels.create({ name: input.names[1], parentID: root.id })
          const children = yield* Effect.forEach(input.childNames, (name) => labels.create({ name, parentID: a.id }))

          const moved = yield* labels.update(a.id, { parentID: b.id })

          expect(a.name).toBe(input.names[0].trim())
          expect(moved.name).toBe(a.name)
          expect(moved.parentID).toBe(b.id)
          expect((yield* labels.get(a.id)).name).toBe(a.name)
          // Compared by ID because SQLite and JavaScript can order unicode names differently.
          const byID = (list: ReadonlyArray<Label.Info>) => [...list].sort((x, y) => x.id.localeCompare(y.id))
          expect(byID(yield* labels.list({ parentID: a.id }))).toEqual(byID(children))
        }),
    ),
  )

  // R2: Adding label A as a child of label B leaves every conversation tagged with A unchanged, and B is not
  // added to those conversations.
  // Kind: invariant
  // Generators: 1–5 conversations tagged with A (the requirement assumes A has conversations), and 0–2 extra
  // labels on each of them, so the check sees conversations with several labels rather than only A.
  it.effect("R2: moving a label under a parent leaves its conversations' labels unchanged", () =>
    assertProperty(
      fc.record({
        // Label A, label B, then 0–2 extra labels that every conversation also carries.
        names: siblingNames(2, 4),
        // At least one conversation, since the requirement is about A's existing conversations.
        conversations: fc.integer({ min: 1, max: 5 }),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const root = yield* createRoot
          const [a, b, ...extras] = yield* Effect.forEach(input.names, (name) =>
            labels.create({ name, parentID: root.id }),
          )
          const sessions = yield* createSessions(input.conversations)
          yield* Effect.forEach(sessions, (sessionID) =>
            Effect.forEach([a, ...extras], (label) => labels.assign({ sessionID, labelID: label.id })),
          )
          const snapshot = Effect.forEach(sessions, (sessionID) =>
            labels
              .forSession(sessionID)
              .pipe(Effect.map((assigned) => assigned.map((label) => [label.id, label.name]))),
          )
          const before = yield* snapshot

          yield* labels.update(a.id, { parentID: b.id })

          const after = yield* snapshot
          expect(after).toEqual(before)
          expect(after.flat().some(([id]) => id === b.id)).toBe(false)
        }),
    ),
  )

  // R3: Creating a label and then deleting it removes that label from the database without affecting any of
  // its conversations.
  // Kind: round trip
  // Generators: any valid name, 0–3 nested children (delete removes the whole subtree, so the round trip must
  // also clean those up), and 0–3 tagged conversations, including none, to check that conversations survive
  // and only lose the deleted label.
  it.effect("R3: creating then deleting a label restores the label list and keeps its conversations", () =>
    assertProperty(
      fc.record({
        // The label that is created and then deleted.
        name: labelName,
        // Child labels under it; delete removes the whole subtree, so these must disappear too.
        childNames: siblingNames(0, 3),
        // 0 covers deleting an unused label; 1–3 checks conversations survive and only lose this label.
        conversations: fc.nat({ max: 3 }),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const { db } = yield* Database.Service
          const before = yield* labels.list()
          const label = yield* labels.create({ name: input.name })
          yield* Effect.forEach(input.childNames, (name) => labels.create({ name, parentID: label.id }))
          const sessions = yield* createSessions(input.conversations)
          yield* Effect.forEach(sessions, (sessionID) => labels.assign({ sessionID, labelID: label.id }))

          yield* labels.remove(label.id)

          expect(yield* labels.list()).toEqual(before)
          expect(
            yield* labels.get(label.id).pipe(
              Effect.flip,
              Effect.map((error) => error._tag),
            ),
          ).toBe("Label.NotFoundError")
          yield* Effect.forEach(sessions, (sessionID) =>
            Effect.gen(function* () {
              const session = yield* db
                .select({ id: SessionTable.id })
                .from(SessionTable)
                .where(eq(SessionTable.id, sessionID))
                .get()
                .pipe(Effect.orDie)
              expect(session?.id).toBe(sessionID)
              expect(yield* labels.forSession(sessionID)).toEqual([])
            }),
          )
        }),
    ),
  )

  // R4: The order in which labels are added as children of a parent label does not matter.
  // Kind: metamorphic
  // Generators: 3–7 distinct names (one parent plus at least two children, matching "at least 3 labels"), and
  // two independent permutations of the children, so the same set is attached in two different orders.
  it.effect("R4: attaching children in any order gives the same hierarchy", () =>
    assertProperty(
      // The first name is the parent and the rest are its children, so there are always at least 3 labels.
      siblingNames(3, 7).chain((names) => {
        // A full permutation of the children's indexes: every child is attached exactly once, in a random order.
        const order = fc.shuffledSubarray(
          Array.from({ length: names.length - 1 }, (_, index) => index),
          { minLength: names.length - 1, maxLength: names.length - 1 },
        )
        // Two independent orders for the same names, which the metamorphic relation compares.
        return fc.record({ names: fc.constant(names), first: order, second: order })
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const build = (order: number[]) =>
            Effect.gen(function* () {
              const root = yield* createRoot
              const [parent, ...children] = yield* Effect.forEach(input.names, (name) =>
                labels.create({ name, parentID: root.id }),
              )
              yield* Effect.forEach(order, (index) => labels.update(children[index].id, { parentID: parent.id }))
              return {
                topLevel: (yield* labels.list({ parentID: root.id })).map((label) => label.name),
                children: (yield* labels.list({ parentID: parent.id })).map((label) => label.name),
              }
            })

          const first = yield* build(input.first)
          const second = yield* build(input.second)

          expect(second).toEqual(first)
          expect(first.topLevel).toEqual([input.names[0].trim()])
          expect(first.children).toHaveLength(input.names.length - 1)
        }),
    ),
  )

  // R5: Getting all conversations with a label returns the correct number of conversations with that label.
  // Kind: invariant
  // Generators: 0–6 conversations with the label (0 is the empty-result boundary), plus 0–3 unlabeled and 0–3
  // carrying a different label as distractors, and a flag that assigns the label twice, since a duplicate
  // assignment must not be counted twice.
  it.effect("R5: counts exactly the conversations assigned a label", () =>
    assertProperty(
      fc.record({
        // x, the number of conversations given the label; 0 is the empty-result boundary.
        labeled: fc.nat({ max: 6 }),
        // Conversations with no label, which must not be counted.
        unlabeled: fc.nat({ max: 3 }),
        // Conversations with a different label, which must not be counted.
        otherLabeled: fc.nat({ max: 3 }),
        // Assigning the same label twice must still count each conversation once.
        assignTwice: fc.boolean(),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const root = yield* createRoot
          const target = yield* labels.create({ name: "Target", parentID: root.id })
          const other = yield* labels.create({ name: "Other", parentID: root.id })
          const tagged = yield* createSessions(input.labeled)
          const others = yield* createSessions(input.otherLabeled)
          const sessions = [...tagged, ...others, ...(yield* createSessions(input.unlabeled))]
          yield* Effect.forEach(input.assignTwice ? [...tagged, ...tagged] : tagged, (sessionID) =>
            labels.assign({ sessionID, labelID: target.id }),
          )
          yield* Effect.forEach(others, (sessionID) => labels.assign({ sessionID, labelID: other.id }))

          const carrying = yield* Effect.filter(sessions, (sessionID) =>
            labels
              .forSession(sessionID)
              .pipe(Effect.map((assigned) => assigned.some((label) => label.id === target.id))),
          )
          expect(carrying).toHaveLength(input.labeled)
          expect([...carrying].sort()).toEqual([...tagged].sort())
        }),
    ),
  )
})
