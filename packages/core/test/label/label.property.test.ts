import { describe, expect } from "bun:test"
import fc from "fast-check"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Label } from "@opencode-ai/core/label"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, Label.node])))

// Every property run uses fresh session IDs and deletes its labels afterwards,
// so runs never see each other's data even though they share one database.
let runs = 0

/*
 * Generators
 *
 * Label pools are small (1-6 names) so generated sessions overlap heavily: the
 * interesting cases for R2 are "the session already has this label" and "it
 * doesn't", and a small pool hits both constantly. Names mix ASCII words with
 * non-ASCII ones ("Área", "À") because label names are matched case-insensitively,
 * and case folding is where ASCII-only inputs hide bugs.
 */
const word = fc.oneof(
  fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,10}[A-Za-z0-9]$/),
  fc.constantFrom("work", "school", "chicken", "Área", "Ünïcode", "À"),
)
const labelPool = fc.uniqueArray(word, {
  minLength: 1,
  maxLength: 6,
  // Top-level names are unique case-insensitively, so the pool must be too.
  selector: (name) => name.toLowerCase(),
})
/** A pool of label names, which of them the session starts with, and one label to pick. */
const sessionLabels = labelPool.chain((names) =>
  fc.record({
    names: fc.constant(names),
    initial: fc.subarray(names.map((_, index) => index)),
    pick: fc.nat({ max: names.length - 1 }),
  }),
)
/** A sequence of label adds and removes; `pick` chooses a label from the pool by index. */
const steps = (minLength: number) =>
  fc.array(fc.record({ add: fc.boolean(), pick: fc.nat() }), { minLength, maxLength: 20 })
/** Leading and trailing whitespace a user might type: spaces, tabs, or nothing at all. */
const padding = fc.stringMatching(/^[ \t]{0,4}$/)

describe("session label properties", () => {
  // R2: Adding a label the session doesn't already have and then removing it
  // leaves the session's labels exactly as they were before.
  // Kind: round-trip
  it.live("R2: adding then removing a new label leaves the session's labels unchanged", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const context = yield* Effect.context<Database.Service>()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(sessionLabels, (input) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const setup = yield* createSetup(labels, input.names)
                yield* Effect.forEach(input.initial, (index) =>
                  labels.assign({ sessionID: setup.session, labelID: setup.ids[index] }),
                )
                // Only a label the session doesn't have counts for this half of R2.
                const fresh = setup.ids.find((_, index) => !input.initial.includes(index))
                if (!fresh) return
                const before = yield* labelIDs(labels, setup.session)

                yield* labels.assign({ sessionID: setup.session, labelID: fresh })
                yield* labels.unassign({ sessionID: setup.session, labelID: fresh })

                expect(yield* labelIDs(labels, setup.session)).toEqual(before)
              }).pipe(Effect.ensuring(cleanup(labels))),
            ),
          ),
          { numRuns: 50 },
        ),
      )
    }),
  )

  // R2: Adding a label the session already has changes nothing.
  // Kind: invariant
  // Repeating the add 1-5 times checks that every extra add is a no-op, not just the second.
  it.live("R2: adding a label the session already has changes nothing, however many times", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const context = yield* Effect.context<Database.Service>()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(sessionLabels, fc.integer({ min: 1, max: 5 }), (input, repeats) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const setup = yield* createSetup(labels, input.names)
                const held = [...new Set([...input.initial, input.pick])]
                yield* Effect.forEach(held, (index) =>
                  labels.assign({ sessionID: setup.session, labelID: setup.ids[index] }),
                )
                const before = yield* labelIDs(labels, setup.session)

                yield* Effect.forEach(Array.from({ length: repeats }), () =>
                  labels.assign({ sessionID: setup.session, labelID: setup.ids[input.pick] }),
                )

                const after = yield* labelIDs(labels, setup.session)
                expect(after).toEqual(before)
                expect(new Set(after).size).toBe(after.length)
              }).pipe(Effect.ensuring(cleanup(labels))),
            ),
          ),
          { numRuns: 50 },
        ),
      )
    }),
  )

  // R2: Adding a label the session doesn't already have and then removing it leaves the
  // session's labels exactly as they were before. Adding a label it already has changes nothing.
  // Kind: model / oracle
  // A plain Set of label IDs is obviously correct, so comparing any interleaving of adds and
  // removes against it checks both halves of R2 together, including repeated adds and removes.
  it.live("R2: any sequence of adds and removes matches a simple set model", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const context = yield* Effect.context<Database.Service>()
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(labelPool, steps(0), (names, sequence) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const setup = yield* createSetup(labels, names)
                const model = new Set<Label.ID>()
                yield* Effect.forEach(sequence, (step) => {
                  const input = { sessionID: setup.session, labelID: setup.ids[step.pick % setup.ids.length] }
                  if (step.add) model.add(input.labelID)
                  if (!step.add) model.delete(input.labelID)
                  return step.add ? labels.assign(input) : labels.unassign(input)
                })
                expect((yield* labelIDs(labels, setup.session)).toSorted()).toEqual([...model].toSorted())
              }).pipe(Effect.ensuring(cleanup(labels))),
            ),
          ),
          { numRuns: 50 },
        ),
      )
    }),
  )

  // R3: Label names are trimmed of leading and trailing spaces when they are created or assigned.
  // Kind: metamorphic
  // Adding whitespace around a name must not change which label it means: when the label
  // already exists, the padded name is rejected as a duplicate instead of creating a second one.
  // Names include 64-character ones, so padding pushes the raw input past the length limit and
  // the property also checks that trimming happens before the length check.
  it.live("R3: a name with extra spaces around it never creates a second label", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const context = yield* Effect.context<Database.Service>()
      const name = fc.oneof(word, fc.stringMatching(/^[a-z]{64}$/))
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(name, padding, padding, (base, left, right) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const root = yield* labels.create({ name: `root-${runs++}` })
                const existing = yield* labels.create({ name: base, parentID: root.id })

                const error = yield* Effect.flip(labels.create({ name: `${left}${base}${right}`, parentID: root.id }))
                expect(error._tag).toBe("Label.DuplicateNameError")

                const children = yield* labels.list({ parentID: root.id })
                expect(children.map((label) => label.id)).toEqual([existing.id])
                expect(children[0].name).toBe(base.trim())
              }).pipe(Effect.ensuring(cleanup(labels))),
            ),
          ),
          { numRuns: 100 },
        ),
      )
    }),
  )

  // R5: Each session in filter results shows the date and time of its last message.
  // Adding or removing labels does not change this time.
  // Kind: invariant
  // The session list shows and sorts by the session's `time_updated`, so that is the time
  // checked here. Times are fixed dates between 2020 and 2030 so the check never depends on "now".
  it.live("R5: adding or removing labels never changes a session's time", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const database = yield* Database.Service
      const context = yield* Effect.context<Database.Service>()
      const time = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) })
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(labelPool, steps(1), time, (names, sequence, updated) =>
            Effect.runPromiseWith(context)(
              Effect.gen(function* () {
                const setup = yield* createSetup(labels, names, updated)
                yield* Effect.forEach(sequence, (step) => {
                  const input = { sessionID: setup.session, labelID: setup.ids[step.pick % setup.ids.length] }
                  return step.add ? labels.assign(input) : labels.unassign(input)
                })
                const row = yield* database.db
                  .select({ time_updated: SessionTable.time_updated })
                  .from(SessionTable)
                  .where(eq(SessionTable.id, setup.session))
                  .get()
                  .pipe(Effect.orDie)
                expect(row?.time_updated).toBe(updated)
              }).pipe(Effect.ensuring(cleanup(labels))),
            ),
          ),
          { numRuns: 50 },
        ),
      )
    }),
  )
})

/** Creates a fresh session plus one top-level label per name. */
function createSetup(labels: Label.Interface, names: ReadonlyArray<string>, updated = 1) {
  return Effect.gen(function* () {
    const session = yield* insertSession(`ses_prop_${runs++}`, updated)
    const ids = yield* Effect.forEach(names, (name) => labels.create({ name }).pipe(Effect.map((label) => label.id)))
    return { session, ids }
  })
}

/**
 * Inserts a session row directly, since core has no session service. Labels only need the
 * row to exist, and writing it directly lets R5 choose the session's time.
 */
function insertSession(id: string, updated: number) {
  return Effect.gen(function* () {
    const database = yield* Database.Service
    const projectID = ProjectV2.ID.make("prj_label_properties")
    yield* database.db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    const sessionID = SessionSchema.ID.make(id)
    yield* database.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: id,
        directory: "/repo",
        title: id,
        version: "test",
        time_created: updated,
        time_updated: updated,
      })
      .run()
      .pipe(Effect.orDie)
    return sessionID
  })
}

function labelIDs(labels: Label.Interface, sessionID: SessionSchema.ID) {
  return labels.forSession(sessionID).pipe(Effect.map((list) => list.map((label) => label.id)))
}

/** Deletes every label so the next property run starts empty. Sessions use fresh IDs each run. */
function cleanup(labels: Label.Interface) {
  return labels
    .list({ parentID: null })
    .pipe(Effect.flatMap((roots) => Effect.forEach(roots, (root) => labels.remove(root.id).pipe(Effect.ignore))))
}
