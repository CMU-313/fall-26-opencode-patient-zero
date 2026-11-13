import { afterAll, expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, ManagedRuntime } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Label } from "@opencode-ai/core/label"
import { LabelTable, SessionLabelTable } from "@opencode-ai/core/label/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"

const runtime = ManagedRuntime.make(AppNodeBuilder.build(LayerNode.group([Database.node, Label.node])))
afterAll(() => runtime.dispose())

type Services = Label.Service | Database.Service
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runtime.runPromise(effect)

const nameArb = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ".split("")), {
    minLength: 1,
    maxLength: 16,
  })
  .map((chars) => chars.join("").trim())
  .filter((name) => name.length > 0)

const scenarioArb = fc
  .uniqueArray(nameArb, { minLength: 1, maxLength: 8, selector: (name) => name.toLowerCase() })
  .chain((names) =>
    fc
      .tuple(
        fc.array(fc.boolean(), { minLength: names.length, maxLength: names.length }),
        fc.integer({ min: 0, max: 10_000 }),
      )
      .filter(([assigned]) => assigned.some((value) => !value))
      .map(([assigned, pick]) => ({ names, assigned, pick })),
  )

const runScenario = (scenario: { names: ReadonlyArray<string>; assigned: ReadonlyArray<boolean>; pick: number }) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const labels = yield* Label.Service

    yield* db.delete(SessionLabelTable).run().pipe(Effect.orDie)
    yield* db.delete(LabelTable).run().pipe(Effect.orDie)
    yield* db.delete(SessionTable).run().pipe(Effect.orDie)
    yield* db.delete(ProjectTable).run().pipe(Effect.orDie)

    const projectID = ProjectV2.ID.make("prj_r2")
    const sessionID = SessionSchema.ID.make("ses_r2")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: projectID,
        slug: "r2",
        directory: "/repo",
        title: "r2",
        version: "test",
        time_created: 1,
        time_updated: 1,
      })
      .run()
      .pipe(Effect.orDie)

    const ids: Label.ID[] = []
    for (const name of scenario.names) {
      const label = yield* labels.create({ name })
      ids.push(label.id)
    }

    for (const [index, assigned] of scenario.assigned.entries())
      if (assigned) yield* labels.assign({ sessionID, labelID: ids[index]! })

    const unassigned = scenario.names.map((_, index) => index).filter((index) => !scenario.assigned[index])
    const targetID = ids[unassigned[scenario.pick % unassigned.length]!]!

    const before = yield* labels.forSession(sessionID)
    yield* labels.assign({ sessionID, labelID: targetID })
    const afterAssign = yield* labels.forSession(sessionID)
    yield* labels.unassign({ sessionID, labelID: targetID })
    const afterRemove = yield* labels.forSession(sessionID)

    return { targetID, before, afterAssign, afterRemove }
  })

test("R2: adding a missing label then removing it restores the session's labels", async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      const result = await run(runScenario(scenario))
      expect(result.before.map((label) => label.id)).not.toContain(result.targetID)
      expect(result.afterAssign.map((label) => label.id)).toContain(result.targetID)
      expect(result.afterRemove).toEqual(result.before)
    }),
    { numRuns: 60, seed: 3132026 },
  )
})

// Strengthened version of the opencode property above (written by me, not opencode).
// R2: Adding a label the session doesn't already have and then removing it leaves the
// session's labels exactly as they were before.
// Kind: round-trip
// opencode's property only ever creates one session, so a removal that deletes the label from
// every session (mutant H2) looks identical to a correct one. This version adds a second
// session that holds the same label before the round trip, and checks that it still has it.
test("R2 (strengthened): the round trip on one session leaves every other session's labels alone", async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      const result = await run(
        Effect.gen(function* () {
          const { db } = yield* Database.Service
          const labels = yield* Label.Service
          const otherID = SessionSchema.ID.make("ses_r2_other")
          const base = yield* runScenario(scenario)
          yield* db
            .insert(SessionTable)
            .values({
              id: otherID,
              project_id: ProjectV2.ID.make("prj_r2"),
              slug: "r2-other",
              directory: "/repo",
              title: "r2-other",
              version: "test",
              time_created: 1,
              time_updated: 1,
            })
            .run()
            .pipe(Effect.orDie)
          const all = yield* labels.list()
          yield* Effect.forEach(all, (label) => labels.assign({ sessionID: otherID, labelID: label.id }))
          const otherBefore = yield* labels.forSession(otherID)

          const sessionID = SessionSchema.ID.make("ses_r2")
          yield* labels.assign({ sessionID, labelID: base.targetID })
          yield* labels.unassign({ sessionID, labelID: base.targetID })

          return { base, afterRemove: yield* labels.forSession(sessionID), otherBefore, otherAfter: yield* labels.forSession(otherID) }
        }),
      )
      expect(result.afterRemove).toEqual(result.base.before)
      expect(result.otherAfter).toEqual(result.otherBefore)
    }),
    { numRuns: 60, seed: 3132026 },
  )
})
