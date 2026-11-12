import { afterEach, describe, expect } from "bun:test"
import fc from "fast-check"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { Label } from "@opencode-ai/core/label"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Session } from "@/session/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Label.node, Session.node, SessionProjector.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  ]),
)

// Same fixed seed as the core property file, so hand-written mutant results are reproducible.
fc.configureGlobal({ seed: 42 })

afterEach(async () => {
  await disposeAllInstances()
})

/*
 * Generators
 *
 * A world is 1-6 sessions, each holding any subset of a 3-label pool. Three labels is few
 * enough that sessions constantly share labels, hold several, or hold none, which are the
 * cases R4's "every session ... and no session that doesn't" is about. The filter label is
 * drawn from the same pool, so some runs filter by a label no session has, plus "dinner",
 * a name no label has at all, so the "no matching label" path is reached too.
 *
 * Session times are distinct fixed dates (Nov 2026, minute resolution) rather than "now",
 * so results never depend on when the test runs, and no two sessions tie on time.
 */
const pool = ["chicken", "work", "lunch"]
const world = fc
  .uniqueArray(fc.integer({ min: 0, max: 30 * 24 * 60 }), { minLength: 1, maxLength: 6 })
  .chain((minutes) =>
    fc.record({
      sessions: fc.tuple(
        ...minutes.map((minute) =>
          fc.record({ updated: fc.constant(Date.UTC(2026, 10, 1) + minute * 60_000), labels: fc.subarray(pool) }),
        ),
      ),
      filter: fc.constantFrom(...pool, "dinner"),
      extra: fc.record({ session: fc.nat(), label: fc.constantFrom(...pool) }),
    }),
  )

describe("session label filter properties", () => {
  // R4: Filtering by a label returns every session that has that label and no session that doesn't.
  // Kind: model / oracle
  // The oracle is the generated world itself: a plain list of which labels each session holds.
  it.instance(
    "R4: filtering by a label returns exactly the sessions that have it",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<Label.Service | Database.Service | Session.Service>()
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(world, (input) =>
              Effect.runPromiseWith(context)(
                Effect.scoped(
                  Effect.gen(function* () {
                    const ids = yield* buildWorld(input.sessions)
                    const expected = ids.filter((_, index) => input.sessions[index].labels.includes(input.filter))

                    const listed = (yield* Session.use.list({ label: input.filter })).map((session) => session.id)

                    expect(listed.toSorted()).toEqual(expected.toSorted())
                  }),
                ),
              ),
            ),
            { numRuns: 25 },
          ),
        )
      }),
    { git: true },
  )

  // R6: Filter results are sorted by the time of each session's last message, newest first.
  // Kind: invariant
  // The session list orders by the session's `time_updated`, so that is the time used here.
  it.instance(
    "R6: filter results are sorted newest first",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<Label.Service | Database.Service | Session.Service>()
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(world, (input) =>
              Effect.runPromiseWith(context)(
                Effect.scoped(
                  Effect.gen(function* () {
                    yield* buildWorld(input.sessions)
                    const times = (yield* Session.use.list({ label: input.filter })).map(
                      (session) => session.time.updated,
                    )
                    expect(times).toEqual(times.toSorted((a, b) => b - a))
                  }),
                ),
              ),
            ),
            { numRuns: 25 },
          ),
        )
      }),
    { git: true },
  )

  // R6: Filter results are sorted by the time of each session's last message, newest first.
  // (Acceptance criteria: adding a label to Monday does not move it above Tuesday.)
  // Kind: metamorphic
  // Adding one more label to any session must leave the order of the filter results unchanged,
  // apart from that session joining the results when the added label is the filter label.
  it.instance(
    "R6: adding a label to a session does not change the order",
    () =>
      Effect.gen(function* () {
        const context = yield* Effect.context<Label.Service | Database.Service | Session.Service>()
        const labels = yield* Label.Service
        yield* Effect.promise(() =>
          fc.assert(
            fc.asyncProperty(world, (input) =>
              Effect.runPromiseWith(context)(
                Effect.scoped(
                  Effect.gen(function* () {
                    const ids = yield* buildWorld(input.sessions)
                    const before = (yield* Session.use.list({ label: input.filter })).map((session) => session.id)

                    const target = ids[input.extra.session % ids.length]
                    const label = (yield* labels.list({ parentID: null })).find(
                      (item) => item.name === input.extra.label,
                    )!
                    yield* labels.assign({ sessionID: target, labelID: label.id })

                    const after = (yield* Session.use.list({ label: input.filter })).map((session) => session.id)
                    expect(after.filter((id) => before.includes(id))).toEqual(before)
                    expect(after.filter((id) => !before.includes(id))).toEqual(
                      input.extra.label === input.filter && !before.includes(target) ? [target] : [],
                    )
                  }),
                ),
              ),
            ),
            { numRuns: 25 },
          ),
        )
      }),
    { git: true },
  )
})

/**
 * Creates the pool labels and one session per generated entry, assigns each session its labels,
 * and sets its time directly in the database so R6 controls the order. Everything is deleted
 * when the scope closes, so the next property run starts empty.
 */
function buildWorld(sessions: ReadonlyArray<{ updated: number; labels: ReadonlyArray<string> }>) {
  return Effect.gen(function* () {
    const labels = yield* Label.Service
    const database = yield* Database.Service
    const byName = new Map(
      yield* Effect.forEach(pool, (name) =>
        Effect.acquireRelease(labels.create({ name }), (label) => labels.remove(label.id).pipe(Effect.ignore)).pipe(
          Effect.map((label) => [name, label.id] as const),
        ),
      ),
    )
    return yield* Effect.forEach(sessions, (entry) =>
      Effect.gen(function* () {
        const session = yield* Effect.acquireRelease(Session.use.create({ title: "property" }), (created) =>
          Session.use.remove(created.id).pipe(Effect.ignore),
        )
        yield* Effect.forEach(entry.labels, (name) =>
          labels.assign({ sessionID: session.id, labelID: byName.get(name)! }),
        )
        yield* database.db
          .update(SessionTable)
          .set({ time_updated: entry.updated })
          .where(eq(SessionTable.id, session.id))
          .run()
          .pipe(Effect.orDie)
        return session.id
      }),
    )
  })
}
