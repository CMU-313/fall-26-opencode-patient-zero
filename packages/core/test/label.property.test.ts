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

fc.configureGlobal({ seed: 42 })

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
          // A third parent that already has a child named like A (differing only by case), so moving A there is
          // rejected as a duplicate and A must be left exactly as it was.
          const taken = yield* labels.create({ name: `taken-${crypto.randomUUID()}`, parentID: root.id })
          const lower = a.name.toLowerCase()
          yield* labels.create({ name: lower.length <= Label.MAX_NAME_LENGTH ? lower : a.name, parentID: taken.id })
          const rejected = yield* labels.update(a.id, { parentID: taken.id }).pipe(Effect.flip)
          expect(rejected).toMatchObject({ _tag: "Label.DuplicateNameError", name: a.name })
          expect(yield* labels.get(a.id)).toEqual(a)

          const moved = yield* labels.update(a.id, { parentID: b.id })

          expect(a.name).toBe(input.names[0].trim())
          expect(moved.name).toBe(a.name)
          expect(moved.parentID).toBe(b.id)
          // Nothing else about A changes either; its creation time is kept.
          expect(a.time.created).toBeNumber()
          expect(moved.time.created).toBe(a.time.created)
          // Adding A to the parent it already has is a no-op: A is not rewritten, so even its update time stays.
          // The short sleep makes a rewrite visible, since update times have millisecond resolution.
          yield* Effect.promise(() => Bun.sleep(2))
          expect(yield* labels.update(a.id, { parentID: b.id })).toEqual(moved)
          expect(yield* labels.get(a.id)).toEqual(moved)
          expect((yield* labels.get(a.id)).name).toBe(a.name)
          // Compared by ID because SQLite and JavaScript can order unicode names differently.
          const byID = (list: ReadonlyArray<Label.Info>) => [...list].sort((x, y) => x.id.localeCompare(y.id))
          expect(byID(yield* labels.list({ parentID: a.id }))).toEqual(byID(children))
        }),
    ),
  )

  // R1: A label's name only changes when it is explicitly renamed, and a rename changes nothing but the name.
  // Kind: invariant
  // Generators: three distinct sibling names (A, its sibling B, and A's new name), plus whether the rename also
  // moves A under B, so renames are checked both on their own and combined with a move.
  it.effect("R1: renaming a label changes only its name", () =>
    assertProperty(
      fc.record({
        // Names for label A, its sibling B, and the new name A is renamed to.
        names: siblingNames(3, 3),
        // Whether the rename is combined with moving A under B.
        move: fc.boolean(),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const root = yield* createRoot
          const a = yield* labels.create({ name: input.names[0], parentID: root.id })
          const b = yield* labels.create({ name: input.names[1], parentID: root.id })

          // Renaming A to B's name (in lowercase) is rejected while they are siblings, and A is left unchanged.
          const lower = b.name.toLowerCase()
          const taken = lower.length <= Label.MAX_NAME_LENGTH ? lower : b.name
          expect(yield* labels.update(a.id, { name: taken }).pipe(Effect.flip)).toMatchObject({
            _tag: "Label.DuplicateNameError",
            name: taken,
          })
          expect(yield* labels.get(a.id)).toEqual(a)

          const renamed = yield* labels.update(
            a.id,
            input.move ? { name: input.names[2], parentID: b.id } : { name: input.names[2] },
          )

          expect(renamed.name).toBe(input.names[2].trim())
          expect(renamed.parentID).toBe(input.move ? b.id : root.id)
          expect(renamed.time.created).toBe(a.time.created)
          expect(yield* labels.get(a.id)).toEqual(renamed)
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
        // Conversations already tagged with B, which must not gain A (or anything else) from the move.
        parentConversations: fc.nat({ max: 3 }),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const root = yield* createRoot
          const [a, b, ...extras] = yield* Effect.forEach(input.names, (name) =>
            labels.create({ name, parentID: root.id }),
          )
          const tagged = yield* createSessions(input.conversations)
          yield* Effect.forEach(tagged, (sessionID) =>
            Effect.forEach([a, ...extras], (label) => labels.assign({ sessionID, labelID: label.id })),
          )
          const parentTagged = yield* createSessions(input.parentConversations)
          yield* Effect.forEach(parentTagged, (sessionID) => labels.assign({ sessionID, labelID: b.id }))
          const sessions = [...tagged, ...parentTagged]
          const snapshot = Effect.forEach(sessions, (sessionID) =>
            labels
              .forSession(sessionID)
              .pipe(Effect.map((assigned) => assigned.map((label) => [label.id, label.name]))),
          )
          const before = yield* snapshot

          yield* labels.update(a.id, { parentID: b.id })

          const after = yield* snapshot
          expect(after).toEqual(before)
          expect(
            after
              .slice(0, tagged.length)
              .flat()
              .some(([id]) => id === b.id),
          ).toBe(false)
          expect(
            after
              .slice(tagged.length)
              .flat()
              .some(([id]) => id === a.id),
          ).toBe(false)
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
        // A name create must reject (blank, or over the limit once trimmed), so no label is ever added for it.
        invalidName: fc.oneof(
          fc.constantFrom("", " ", "\t\n "),
          fc
            .string({ minLength: Label.MAX_NAME_LENGTH + 1, maxLength: Label.MAX_NAME_LENGTH + 16 })
            .filter((name) => name.trim().length > Label.MAX_NAME_LENGTH),
        ),
      }),
      (input) =>
        Effect.gen(function* () {
          const labels = yield* Label.Service
          const { db } = yield* Database.Service
          const before = yield* labels.list()
          const invalid = yield* labels.create({ name: input.invalidName }).pipe(Effect.flip)
          expect(invalid).toMatchObject({ _tag: "Label.InvalidNameError", name: input.invalidName })
          expect(invalid._tag === "Label.InvalidNameError" && invalid.reason).not.toBe("")
          expect(yield* labels.list()).toEqual(before)

          const label = yield* labels.create({ name: input.name })
          // The created label is a top-level label, and a second top-level label with the same name is rejected.
          expect(yield* labels.list({ parentID: null })).toContainEqual(label)
          expect(yield* labels.create({ name: label.name }).pipe(Effect.flip)).toMatchObject({
            _tag: "Label.DuplicateNameError",
            name: label.name,
          })
          const children = yield* Effect.forEach(input.childNames, (name) =>
            labels.create({ name, parentID: label.id }),
          )
          const sessions = yield* createSessions(input.conversations)
          yield* Effect.forEach(sessions, (sessionID) => labels.assign({ sessionID, labelID: label.id }))

          const removed = yield* labels.remove(label.id)

          // remove reports every label it deleted: the label itself and its whole subtree.
          expect([...removed].sort()).toEqual([label.id, ...children.map((child) => child.id)].sort())
          expect(yield* labels.list()).toEqual(before)
          // The deleted label is gone from the database, so it can no longer be used as a parent.
          expect(yield* labels.create({ name: input.name, parentID: label.id }).pipe(Effect.flip)).toMatchObject({
            _tag: "Label.NotFoundError",
            id: label.id,
          })
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
                root,
                parent,
                children,
                topLevel: (yield* labels.list({ parentID: root.id })).map((label) => label.name),
                childNames: (yield* labels.list({ parentID: parent.id })).map((label) => label.name),
              }
            })

          const first = yield* build(input.first)
          const second = yield* build(input.second)

          expect(second.topLevel).toEqual(first.topLevel)
          expect(second.childNames).toEqual(first.childNames)
          expect(first.topLevel).toEqual([input.names[0].trim()])
          expect(first.childNames).toHaveLength(input.names.length - 1)

          // The result stays one parent with every other label beneath it: the parent can never be added as a
          // child of itself, of one of its children, or of a grandchild, and those attempts change nothing.
          const [child, grandchild] = second.children
          yield* labels.update(grandchild.id, { parentID: child.id })
          yield* Effect.forEach([second.parent, child, grandchild], (target) =>
            Effect.gen(function* () {
              const error = yield* labels.update(second.parent.id, { parentID: target.id }).pipe(Effect.flip)
              expect(error).toMatchObject({ _tag: "Label.CycleError", id: second.parent.id, parentID: target.id })
            }),
          )
          expect((yield* labels.get(second.parent.id)).parentID).toBe(second.root.id)
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
        // Also try assigning the label to a conversation that does not exist, which must be rejected and not counted.
        missingSession: fc.boolean(),
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
          if (input.missingSession) {
            const missing = SessionSchema.ID.make(`ses_${crypto.randomUUID()}`)
            expect(yield* labels.assign({ sessionID: missing, labelID: target.id }).pipe(Effect.flip)).toMatchObject({
              _tag: "Label.SessionNotFoundError",
              sessionID: missing,
            })
            expect(yield* labels.forSession(missing)).toEqual([])
          }

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
