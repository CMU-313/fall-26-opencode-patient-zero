import { afterAll, describe, expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, ManagedRuntime } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Label } from "@opencode-ai/core/label"
import { LabelTable, SessionLabelTable } from "@opencode-ai/core/label/sql"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"

// R6: A label can never be moved under itself or one of its own nested labels.
// Written by opencode (Big Pickle) in P5 for the agent failure case; strengthened by me afterwards.
// opencode's version tried every destination inside the subtree but only ONE legal move (always the
// lowest-index label outside the subtree, usually label 0) and never a move to the top level, so mutant X1
// (`input.parentID ?? current.parent_id`, which turns "move to top level" into a silent no-op) survived.
// Strengthened: for every destination, including the top level (null), rebuild the tree and check the
// move against the model: rejected with CycleError and nothing changed if the destination is inside the
// subtree, otherwise accepted with exactly the requested parent and every other label untouched.

const runtime = ManagedRuntime.make(AppNodeBuilder.build(LayerNode.group([Database.node, Label.node])))
afterAll(() => runtime.dispose())

type Services = Label.Service | Database.Service
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runtime.runPromise(effect)

const SEED = 3132026
const RUNS = { numRuns: 60, seed: SEED }

const check = async (name: string, property: fc.IAsyncPropertyWithHooks<any>) => {
  await fc.assert(property, RUNS)
  console.log(`[label property] ${name}: passed ${RUNS.numRuns} generated cases (seed ${SEED})`)
}

/** A valid tree as parent indexes: -1 is top level, otherwise the index of an earlier label. */
const treeArb = fc
  .integer({ min: 1, max: 10 })
  .chain((size) =>
    fc.tuple(
      ...Array.from({ length: size }, (_, i) => (i === 0 ? fc.constant(-1) : fc.integer({ min: -1, max: i - 1 }))),
    ),
  )

const reset = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db.delete(SessionLabelTable).run().pipe(Effect.orDie)
  yield* db.delete(LabelTable).run().pipe(Effect.orDie)
  yield* db.delete(SessionTable).run().pipe(Effect.orDie)
  yield* db.delete(ProjectTable).run().pipe(Effect.orDie)
})

/** Creates labels for a parent-index tree. Names get an index suffix so siblings never collide. */
const buildTree = (parents: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    const labels = yield* Label.Service
    const ids: Label.ID[] = []
    for (const [i, parent] of parents.entries()) {
      const label = yield* labels.create({ name: `L${i}`, parentID: parent === -1 ? undefined : ids[parent] })
      ids.push(label.id)
    }
    return ids
  })

/** Every label as {id, name, parentID}, for checking the tree is unchanged. */
const snapshot = Effect.gen(function* () {
  const labels = yield* Label.Service
  return (yield* labels.list()).map(({ id, name, parentID }) => ({ id, name, parentID }))
})

/** Oracle for "a label and everything nested under it", from the parent-index array. */
const modelSubtree = (parents: ReadonlyArray<number>, root: number) => {
  const inside = new Set([root])
  for (const [i, parent] of parents.entries()) if (parent !== -1 && inside.has(parent)) inside.add(i)
  return inside
}

/** Runs an effect that should fail and returns the error, or undefined if it succeeded. */
const failure = <A, E>(effect: Effect.Effect<A, E, Services>) =>
  effect.pipe(
    Effect.flip,
    Effect.catch(() => Effect.succeed(undefined)),
  )

describe("Label cycle properties", () => {
  test("R6 (model): a label cannot be moved under itself or a nested label", async () => {
    await check(
      "R6-agent",
      fc.asyncProperty(
        treeArb.chain((parents) => fc.tuple(fc.constant(parents), fc.integer({ min: 0, max: parents.length - 1 }))),
        ([parents, moved]) =>
          run(
            Effect.gen(function* () {
              const labels = yield* Label.Service
              const subtree = modelSubtree(parents, moved)
              // -1 stands for the top level (parentID: null); every label in the tree is also a destination.
              for (const destination of [-1, ...parents.keys()]) {
                yield* reset
                const ids = yield* buildTree(parents)
                const before = yield* snapshot
                const parentID = destination === -1 ? null : ids[destination]!
                const error = yield* failure(labels.update(ids[moved]!, { parentID }))

                if (destination !== -1 && subtree.has(destination)) {
                  expect(error?._tag).toBe("Label.CycleError")
                  expect(yield* snapshot).toEqual(before)
                } else {
                  expect(error).toBeUndefined()
                  const after = yield* snapshot
                  const expected = before.map((label) =>
                    label.id === ids[moved] ? { ...label, parentID: parentID ?? undefined } : label,
                  )
                  const byId = (list: typeof before) => list.toSorted((a, b) => a.id.localeCompare(b.id))
                  expect(byId(after)).toEqual(byId(expected))
                }
              }
            }),
          ),
      ),
    )
  })
})
