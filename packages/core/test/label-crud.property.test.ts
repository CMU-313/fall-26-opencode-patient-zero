import { afterAll, describe, expect, test } from "bun:test"
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

// Property-based tests for the Label CRUD requirements (traceability/dylany.md).
// One in-memory database is shared per file and wiped before every generated case,
// so each case starts from an empty label tree.

const runtime = ManagedRuntime.make(AppNodeBuilder.build(LayerNode.group([Database.node, Label.node])))
afterAll(() => runtime.dispose())

type Services = Label.Service | Database.Service
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => runtime.runPromise(effect)

// Keeps CI fast while still trying many trees per property. The seed is fixed so every run (local, CI and
// Stryker) generates the same cases, which makes mutation results reproducible. Recorded in traceability/dylany.md.
const SEED = 3132026
const RUNS = { numRuns: 60, seed: SEED }

/**
 * Runs a property and prints one line when it passes. The core package runs `bun test --only-failures`,
 * which hides passing test names, so this line is what shows each property running in the CI log.
 */
const check = async (name: string, property: fc.IAsyncPropertyWithHooks<any>) => {
  await fc.assert(property, RUNS)
  console.log(`[label property] ${name}: passed ${RUNS.numRuns} generated cases (seed ${SEED})`)
}

// ---------- Generators ----------

/**
 * A label tree as a list of parent indexes: entry i is -1 (top level) or the index of an earlier
 * label, so every generated tree is valid (no cycles). Trees run from 1 to 10 labels, which reaches
 * the cases interviewees cared about: flat lists, deep chains like School/Databases/SQL, and wide
 * parents with many children.
 */
const treeArb = fc
  .integer({ min: 1, max: 10 })
  .chain((size) =>
    fc.tuple(
      ...Array.from({ length: size }, (_, i) => (i === 0 ? fc.constant(-1) : fc.integer({ min: -1, max: i - 1 }))),
    ),
  )

/**
 * Label names: letters, digits and inner spaces, including a few non-ASCII letters (É, é, Ü, ü, Ö, ö)
 * because labels are free text and users name them in their own language. Names never start or end
 * with whitespace, so a padded variant is always a real "same name with extra spaces" case.
 */
const nameChar = fc.constantFrom(..."abcdefghijkABCDEFGHIJK0123456789 ÉéÜüÖö".split(""))
const nameArb = fc
  .string({ unit: nameChar, minLength: 1, maxLength: 20 })
  .map((name) => name.trim())
  .filter((name) => name.length > 0)

/** The same name as a user might retype it: random letter case plus leading/trailing whitespace (R4, interviews S-4, C-4, O-6). */
const variantArb = (name: string) =>
  fc
    .tuple(
      fc.array(fc.boolean(), { minLength: name.length, maxLength: name.length }),
      fc.constantFrom("", " ", "  ", "\t", " \n"),
      fc.constantFrom("", " ", "  ", "\t", "\n "),
    )
    .map(([flips, before, after]) => {
      const cased = [...name]
        .map((char, i) => (flips[i] ? (char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase()) : char))
        .join("")
      return before + cased + after
    })

/** Up to 4 chats, each tagged with a random subset of the tree's labels. */
const assignmentsArb = (labels: number) =>
  fc.array(fc.array(fc.integer({ min: 0, max: labels - 1 }), { maxLength: labels }), { minLength: 1, maxLength: 4 })

// ---------- Helpers ----------

/** Empties every table the label service touches, so each generated case starts clean. */
const reset = Effect.gen(function* () {
  const { db } = yield* Database.Service
  yield* db.delete(SessionLabelTable).run().pipe(Effect.orDie)
  yield* db.delete(LabelTable).run().pipe(Effect.orDie)
  yield* db.delete(SessionTable).run().pipe(Effect.orDie)
  yield* db.delete(ProjectTable).run().pipe(Effect.orDie)
})

/** Creates labels for a parent-index tree. Names get an index suffix so siblings never collide. */
const buildTree = (parents: ReadonlyArray<number>, base = "L") =>
  Effect.gen(function* () {
    const labels = yield* Label.Service
    const ids: Label.ID[] = []
    for (const [i, parent] of parents.entries()) {
      const label = yield* labels.create({ name: `${base}${i}`, parentID: parent === -1 ? undefined : ids[parent] })
      ids.push(label.id)
    }
    return ids
  })

/** Creates chats (sessions) and tags each one with the given label indexes. */
const tagChats = (ids: ReadonlyArray<Label.ID>, assignments: ReadonlyArray<ReadonlyArray<number>>) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const labels = yield* Label.Service
    const projectID = ProjectV2.ID.make("prj_props")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 })
      .run()
      .pipe(Effect.orDie)
    const sessions = assignments.map((_, i) => SessionSchema.ID.make(`ses_prop${i}`))
    yield* db
      .insert(SessionTable)
      .values(
        sessions.map((id) => ({
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
    for (const [i, tags] of assignments.entries())
      for (const tag of tags) yield* labels.assign({ sessionID: sessions[i]!, labelID: ids[tag]! })
    return sessions
  })

/** Every label as {id, name, parentID}, for comparing whole trees before and after an operation. */
const snapshot = Effect.gen(function* () {
  const labels = yield* Label.Service
  return (yield* labels.list()).map(({ id, name, parentID }) => ({ id, name, parentID }))
})

const chatTags = (sessions: ReadonlyArray<SessionSchema.ID>) =>
  Effect.gen(function* () {
    const labels = yield* Label.Service
    return yield* Effect.forEach(sessions, (session) =>
      labels.forSession(session).pipe(Effect.map((tags) => tags.map((tag) => tag.id))),
    )
  })

const sessionCount = Effect.gen(function* () {
  const { db } = yield* Database.Service
  return (yield* db.select({ id: SessionTable.id }).from(SessionTable).all().pipe(Effect.orDie)).length
})

/** Oracle for "a label and everything nested under it": a plain walk over the parent-index array. */
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

// ---------- Properties ----------

describe("Label properties", () => {
  // R1: Deleting a label never deletes the chats tagged with it.
  // Kind: invariant
  // For any tree, any tagging of chats, and any label deleted: every chat still exists, no chat keeps a
  // deleted label, and chats keep all their other labels.
  test("R1 (invariant): deleting a label never deletes chats", async () => {
    await check(
      "R1",
      fc.asyncProperty(
        treeArb.chain((parents) =>
          fc.tuple(
            fc.constant(parents),
            assignmentsArb(parents.length),
            fc.integer({ min: 0, max: parents.length - 1 }),
          ),
        ),
        ([parents, assignments, target]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const sessions = yield* tagChats(ids, assignments)
              const before = yield* chatTags(sessions)

              const removed = new Set(yield* labels.remove(ids[target]!))

              expect(yield* sessionCount).toBe(sessions.length)
              const after = yield* chatTags(sessions)
              after.forEach((tags, i) => {
                expect(tags.some((tag) => removed.has(tag))).toBe(false)
                expect(tags.toSorted()).toEqual(before[i]!.filter((tag) => !removed.has(tag)).toSorted())
              })
            }),
          ),
      ),
    )
  })

  // R2: Deleting a label also deletes every label nested under it.
  // Kind: model / oracle
  // The labels left after a delete must match a simple in-memory model: the tree minus the deleted
  // label's subtree, computed by walking the parent-index array.
  test("R2 (model): deleting a label removes exactly its subtree", async () => {
    await check(
      "R2",
      fc.asyncProperty(
        treeArb.chain((parents) => fc.tuple(fc.constant(parents), fc.integer({ min: 0, max: parents.length - 1 }))),
        ([parents, target]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const expectedGone = modelSubtree(parents, target)

              const removed = yield* labels.remove(ids[target]!)

              expect(removed.toSorted()).toEqual([...expectedGone].map((i) => ids[i]!).toSorted())
              const remaining = (yield* snapshot).map((label) => label.id).toSorted()
              expect(remaining).toEqual(ids.filter((_, i) => !expectedGone.has(i)).toSorted())
            }),
          ),
      ),
    )
  })

  // R3: Renaming a label and then renaming it back restores its original state
  // (same ID, name, parent, nested labels and tagged chats; only the last-updated time may change).
  // Kind: round-trip
  test("R3 (round-trip): rename then rename back restores the label", async () => {
    await check(
      "R3",
      fc.asyncProperty(
        treeArb.chain((parents) =>
          fc.tuple(
            fc.constant(parents),
            assignmentsArb(parents.length),
            fc.integer({ min: 0, max: parents.length - 1 }),
            nameArb,
          ),
        ),
        ([parents, assignments, target, newName]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const sessions = yield* tagChats(ids, assignments)
              const original = yield* labels.get(ids[target]!)
              const treeBefore = yield* snapshot
              const tagsBefore = yield* chatTags(sessions)

              // Skip names that collide with a sibling; R4 covers that case.
              const siblings = treeBefore.filter((l) => l.parentID === original.parentID && l.id !== original.id)
              fc.pre(!siblings.some((l) => l.name.toLowerCase() === newName.toLowerCase()))

              yield* labels.update(original.id, { name: newName })
              const restored = yield* labels.update(original.id, { name: original.name })

              expect({ ...restored, time: undefined }).toEqual({ ...original, time: undefined })
              expect(restored.time.created).toBe(original.time.created)
              // Added in P5 (Stryker survivor): timestamps must still be real numbers after a round trip.
              expect(typeof restored.time.created).toBe("number")
              expect(restored.time.updated).toBeGreaterThanOrEqual(restored.time.created)
              expect(yield* snapshot).toEqual(treeBefore)
              expect(yield* chatTags(sessions)).toEqual(tagsBefore)
            }),
          ),
      ),
    )
  })

  // R4: Label names are trimmed, and two labels under the same parent can't have the same name, ignoring case.
  // Kind: metamorphic
  // Changing a name only by letter case and surrounding whitespace must give the same result as creating
  // the exact same name again: a DuplicateNameError, with the tree left unchanged.
  test("R4 (metamorphic): case and whitespace variants of a sibling name are duplicates", async () => {
    await check(
      "R4",
      fc.asyncProperty(
        nameArb.chain((name) => fc.tuple(fc.constant(name), variantArb(name), fc.boolean())),
        ([name, variant, nested]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const parent = nested ? (yield* labels.create({ name: "Parent" })).id : undefined
              yield* labels.create({ name, parentID: parent })
              const before = yield* snapshot

              const exact = yield* failure(labels.create({ name, parentID: parent }))
              const changed = yield* failure(labels.create({ name: variant, parentID: parent }))

              expect(exact?._tag).toBe("Label.DuplicateNameError")
              expect(changed?._tag).toBe(exact?._tag)
              expect(yield* snapshot).toEqual(before)
            }),
          ),
      ),
    )
  })

  // R4: Label names are trimmed, and two labels under the same parent can't have the same name, ignoring case.
  // Kind: metamorphic
  // The flip side of the property above: a label is never a duplicate of itself. Renaming a label to a
  // case or whitespace variant of its own name (e.g. fixing "homework" to "Homework") must succeed and
  // store the trimmed variant, with nothing else in the tree changing. Added in P5 to kill mutant H6.
  test("R4 (metamorphic): renaming a label to a variant of its own name succeeds", async () => {
    await check(
      "R4-self",
      fc.asyncProperty(
        treeArb
          .chain((parents) => fc.tuple(fc.constant(parents), fc.integer({ min: 0, max: parents.length - 1 }), nameArb))
          .chain(([parents, target, name]) =>
            fc.tuple(fc.constant(parents), fc.constant(target), fc.constant(name), variantArb(name)),
          ),
        ([parents, target, name, variant]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const id = ids[target]!
              // Give the target a generated name first, skipping names its siblings already use.
              const siblings = (yield* snapshot).filter(
                (l) => l.parentID === (parents[target] === -1 ? undefined : ids[parents[target]!]) && l.id !== id,
              )
              fc.pre(!siblings.some((l) => l.name.toLowerCase() === name.toLowerCase()))
              yield* labels.update(id, { name })
              const before = yield* snapshot

              const renamed = yield* labels.update(id, { name: variant })

              expect(renamed.name).toBe(variant.trim())
              // Compare by ID: list() sorts by name, so the rename may move the label in the list.
              const byId = (labels: ReadonlyArray<{ id: string }>) =>
                labels.toSorted((a, b) => a.id.localeCompare(b.id))
              const after = (yield* snapshot).map((l) => (l.id === id ? { ...l, name } : l))
              expect(byId(after)).toEqual(byId(before))
            }),
          ),
      ),
    )
  })

  // R5: The same name is allowed under different parents.
  // Kind: invariant
  // For any name and any set of distinct parents, creating that name under each parent always succeeds,
  // and each copy sits under its own parent.
  test("R5 (invariant): one name can exist under every different parent", async () => {
    await check(
      "R5",
      fc.asyncProperty(treeArb, nameArb, (parents, name) =>
        run(
          Effect.gen(function* () {
            yield* reset
            const labels = yield* Label.Service
            const ids = yield* buildTree(parents, "P")
            for (const id of ids) {
              const copy = yield* labels.create({ name, parentID: id })
              expect(copy.parentID).toBe(id)
              expect(copy.name).toBe(name)
            }
            const copies = (yield* snapshot).filter((label) => label.name === name)
            expect(copies.map((label) => label.parentID).toSorted()).toEqual([...ids].toSorted())
          }),
        ),
      ),
    )
  })

  // R6: A label can never be moved under itself or one of its own nested labels.
  // Kind: model / oracle
  // For any tree and any move, the move is rejected with CycleError (tree unchanged) exactly when the
  // model says the destination is inside the label's own subtree; every other move succeeds.
  test("R6 (model): moves into a label's own subtree are rejected, all others succeed", async () => {
    await check(
      "R6",
      fc.asyncProperty(
        treeArb.chain((parents) =>
          fc.tuple(
            fc.constant(parents),
            fc.integer({ min: 0, max: parents.length - 1 }),
            fc.integer({ min: 0, max: parents.length - 1 }),
          ),
        ),
        ([parents, moved, destination]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const before = yield* snapshot
              const wouldCycle = modelSubtree(parents, moved).has(destination)

              const error = yield* failure(labels.update(ids[moved]!, { parentID: ids[destination]! }))

              if (wouldCycle) {
                expect(error?._tag).toBe("Label.CycleError")
                expect(yield* snapshot).toEqual(before)
              } else {
                expect(error).toBeUndefined()
                expect((yield* labels.get(ids[moved]!)).parentID).toBe(ids[destination]!)
              }
            }),
          ),
      ),
    )
  })

  // R7 (revised in P4): A rejected label operation fails with a specific error type for the reason
  // (not found, invalid name, duplicate name, or cycle), its message names the label involved, and
  // nothing in the label tree changes.
  // Kind: invariant
  test("R7 (invariant): rejected operations explain why and change nothing", async () => {
    const invalidOp = fc.constantFrom(
      "duplicate",
      "missingParent",
      "emptyName",
      "cycle",
      "deleteMissing",
      "renameMissing",
    )
    await check(
      "R7",
      fc.asyncProperty(
        treeArb.chain((parents) =>
          fc.tuple(fc.constant(parents), fc.integer({ min: 0, max: parents.length - 1 }), invalidOp),
        ),
        ([parents, target, op]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const label = yield* labels.get(ids[target]!)
              const missing = Label.ID.make("lbl_missing")
              const before = yield* snapshot

              const cases = {
                duplicate: {
                  effect: labels.create({ name: label.name, parentID: label.parentID }),
                  tag: "Label.DuplicateNameError",
                  mentions: label.name,
                },
                missingParent: {
                  effect: labels.create({ name: "New", parentID: missing }),
                  tag: "Label.NotFoundError",
                  mentions: missing,
                },
                emptyName: {
                  effect: labels.update(label.id, { name: "   " }),
                  tag: "Label.InvalidNameError",
                  mentions: "empty",
                },
                cycle: {
                  effect: labels.update(label.id, { parentID: label.id }),
                  tag: "Label.CycleError",
                  mentions: label.id,
                },
                deleteMissing: { effect: labels.remove(missing), tag: "Label.NotFoundError", mentions: missing },
                renameMissing: {
                  effect: labels.update(missing, { name: "Renamed" }),
                  tag: "Label.NotFoundError",
                  mentions: missing,
                },
              } as const
              const expected = cases[op]

              const error = yield* failure(
                expected.effect as Effect.Effect<unknown, { _tag: string; message: string }, Services>,
              )

              expect(error?._tag).toBe(expected.tag)
              expect(error?.message).toContain(expected.mentions)
              expect(yield* snapshot).toEqual(before)
            }),
          ),
      ),
    )
  })

  // R7 (revised in P4): A rejected label operation fails with a specific error type for the reason, its
  // message names the problem, and nothing in the label tree changes.
  // Kind: invariant
  // Added in P5 to kill Stryker survivors at the 64-character name limit. The generator picks name lengths
  // right around the limit (55 to 75 characters, plus optional surrounding spaces) because that boundary is
  // where an off-by-one (> vs >=) or a missing check would hide; the earlier name generator never got past 20.
  test("R7 (invariant): names over 64 characters are rejected with a clear error, others are kept", async () => {
    const longNameArb = fc
      .tuple(
        fc.integer({ min: 55, max: 75 }),
        fc.constantFrom("a", "B", "7", "é"),
        fc.constantFrom("", " ", "  "),
        fc.boolean(),
      )
      .map(([length, char, pad, rename]) => ({ name: pad + char.repeat(length) + pad, length, rename }))
    await check(
      "R7-length",
      fc.asyncProperty(longNameArb, ({ name, length, rename }) =>
        run(
          Effect.gen(function* () {
            yield* reset
            const labels = yield* Label.Service
            const existing = yield* labels.create({ name: "Existing" })
            const before = yield* snapshot

            const attempt = rename ? labels.update(existing.id, { name }) : labels.create({ name })
            const error = yield* failure(attempt)

            if (length > Label.MAX_NAME_LENGTH) {
              expect(error?._tag).toBe("Label.InvalidNameError")
              expect(error?.message).toContain(`${Label.MAX_NAME_LENGTH} characters`)
              expect(yield* snapshot).toEqual(before)
            } else {
              expect(error).toBeUndefined()
              expect((yield* snapshot).some((l) => l.name === name.trim())).toBe(true)
            }
          }),
        ),
      ),
    )
  })

  // R9 (new in P5): Listing the top level returns exactly the labels with no parent, and listing a label's
  // children returns exactly its direct children.
  // Kind: model / oracle
  // Interview evidence: S-2 (filter and sort chats by label), O-8 ("wrong result whenever the UI tree
  // desynchronizes from the backend"). Added in P5 because Stryker showed list()'s filtering was untested.
  test("R9 (model): listing by parent matches the tree", async () => {
    await check(
      "R9",
      fc.asyncProperty(treeArb, (parents) =>
        run(
          Effect.gen(function* () {
            yield* reset
            const labels = yield* Label.Service
            const ids = yield* buildTree(parents)
            const sortIds = (list: ReadonlyArray<{ id: string }>) => list.map((l) => l.id).toSorted()

            const top = yield* labels.list({ parentID: null })
            expect(sortIds(top)).toEqual(ids.filter((_, i) => parents[i] === -1).toSorted())

            for (const [i, id] of ids.entries()) {
              const children = yield* labels.list({ parentID: id })
              expect(sortIds(children)).toEqual(ids.filter((_, j) => parents[j] === i).toSorted())
            }
            expect((yield* labels.list()).length).toBe(ids.length)
          }),
        ),
      ),
    )
  })

  // R8: Labels are only assigned to a chat when the user explicitly assigns them.
  // Kind: invariant
  // For any sequence of label operations that are not assign/unassign (create, rename, move), every
  // chat's labels stay exactly the same.
  test("R8 (invariant): creating, renaming and moving labels never changes a chat's labels", async () => {
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant("create" as const), name: nameArb, parent: fc.nat() }),
      fc.record({ kind: fc.constant("rename" as const), name: nameArb, target: fc.nat() }),
      fc.record({ kind: fc.constant("move" as const), target: fc.nat(), parent: fc.nat() }),
    )
    await check(
      "R8",
      fc.asyncProperty(
        treeArb.chain((parents) =>
          fc.tuple(fc.constant(parents), assignmentsArb(parents.length), fc.array(opArb, { maxLength: 8 })),
        ),
        ([parents, assignments, ops]) =>
          run(
            Effect.gen(function* () {
              yield* reset
              const labels = yield* Label.Service
              const ids = yield* buildTree(parents)
              const sessions = yield* tagChats(ids, assignments)
              const before = yield* chatTags(sessions)

              // Rejected operations (duplicates, cycles) are fine here; only chat tags matter.
              for (const op of ops) {
                const pick = (n: number) => ids[n % ids.length]!
                const step =
                  op.kind === "create"
                    ? labels
                        .create({ name: op.name, parentID: pick(op.parent) })
                        .pipe(Effect.map((l) => ids.push(l.id)))
                    : op.kind === "rename"
                      ? labels.update(pick(op.target), { name: op.name })
                      : labels.update(pick(op.target), { parentID: pick(op.parent) })
                yield* Effect.ignore(step)
              }

              // Compare as sets: forSession sorts by name, so a rename may reorder a chat's labels
              // without adding or removing any.
              const sorted = (tags: ReadonlyArray<ReadonlyArray<string>>) => tags.map((t) => t.toSorted())
              expect(sorted(yield* chatTags(sessions))).toEqual(sorted(before))
            }),
          ),
      ),
    )
  })
})
