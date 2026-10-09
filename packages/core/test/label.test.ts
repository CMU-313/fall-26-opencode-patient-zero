import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq, sql } from "drizzle-orm"
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

const missing = Label.ID.make("lbl_missing")

/** Inserts a project and sessions with the given IDs so labels can be assigned to them. */
const createSessions = (...ids: string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projectID = ProjectV2.ID.make("prj_labels")
    yield* db
      .insert(ProjectTable)
      .values({ id: projectID, worktree: AbsolutePath.make("/repo"), sandboxes: [], time_created: 1, time_updated: 1 })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values(
        ids.map((id) => ({
          id: SessionSchema.ID.make(id),
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
    return ids.map((id) => SessionSchema.ID.make(id))
  })

/** Runs an effect that is expected to fail and returns the error's tag. */
const failureTag = <A, E extends { _tag: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error._tag),
  )

describe("Label", () => {
  describe("create", () => {
    it.effect("creates a top-level label with a trimmed name", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const label = yield* labels.create({ name: "  Coursework  " })

        expect(label.id.startsWith("lbl_")).toBe(true)
        expect(label.name).toBe("Coursework")
        expect(label.parentID).toBeUndefined()
        expect(yield* labels.get(label.id)).toEqual(label)
      }),
    )

    it.effect("creates a nested label under an existing parent", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const parent = yield* labels.create({ name: "Coursework" })
        const child = yield* labels.create({ name: "Databases", parentID: parent.id })

        expect(child.parentID).toBe(parent.id)
      }),
    )

    it.effect("rejects empty and overly long names", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service

        expect(yield* failureTag(labels.create({ name: "   " }))).toBe("Label.InvalidNameError")
        expect(yield* failureTag(labels.create({ name: "x".repeat(Label.MAX_NAME_LENGTH + 1) }))).toBe(
          "Label.InvalidNameError",
        )
      }),
    )

    it.effect("rejects a parent that does not exist", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service

        expect(yield* failureTag(labels.create({ name: "Orphan", parentID: missing }))).toBe("Label.NotFoundError")
        expect(yield* labels.list()).toEqual([])
      }),
    )

    it.effect("rejects duplicate sibling names case-insensitively but allows them at different levels", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const a = yield* labels.create({ name: "Homework" })
        const b = yield* labels.create({ name: "Projects" })

        expect(yield* failureTag(labels.create({ name: "homework" }))).toBe("Label.DuplicateNameError")
        yield* labels.create({ name: "Notes", parentID: a.id })
        yield* labels.create({ name: "Notes", parentID: b.id })
        expect(yield* failureTag(labels.create({ name: "NOTES", parentID: a.id }))).toBe("Label.DuplicateNameError")
      }),
    )
  })

  it.effect("rejects an empty-string parent ID with NotFoundError instead of a database error", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const empty = Label.ID.make("")
      const label = yield* labels.create({ name: "Label" })

      expect(yield* failureTag(labels.create({ name: "Orphan", parentID: empty }))).toBe("Label.NotFoundError")
      expect(yield* failureTag(labels.update(label.id, { parentID: empty }))).toBe("Label.NotFoundError")
      expect(yield* labels.list()).toEqual([label])
    }),
  )

  describe("read", () => {
    it.effect("fails to get a label that does not exist", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        expect(yield* failureTag(labels.get(missing))).toBe("Label.NotFoundError")
      }),
    )

    it.effect("lists all labels, top-level labels, or children of one label", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const school = yield* labels.create({ name: "School" })
        const personal = yield* labels.create({ name: "Personal" })
        const math = yield* labels.create({ name: "Math", parentID: school.id })
        const art = yield* labels.create({ name: "Art", parentID: school.id })
        const algebra = yield* labels.create({ name: "Algebra", parentID: math.id })

        expect(new Set((yield* labels.list()).map((label) => label.id))).toEqual(
          new Set([school.id, personal.id, math.id, art.id, algebra.id]),
        )
        expect(new Set((yield* labels.list({ parentID: null })).map((label) => label.id))).toEqual(
          new Set([personal.id, school.id]),
        )
        expect(new Set((yield* labels.list({ parentID: school.id })).map((label) => label.id))).toEqual(
          new Set([art.id, math.id]),
        )
        expect(yield* labels.list({ parentID: math.id })).toEqual([algebra])
        expect(yield* labels.list({ parentID: personal.id })).toEqual([])
      }),
    )
  })

  describe("update", () => {
    it.effect("renames a label and advances its update timestamp", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const database = yield* Database.Service
        const label = yield* labels.create({ name: "Draft" })
        yield* database.db.run(sql`UPDATE label SET time_created = 10, time_updated = 10 WHERE id = ${label.id}`)
        const before = yield* labels.get(label.id)
        const renamed = yield* labels.update(label.id, { name: " Final " })

        expect(renamed.name).toBe("Final")
        expect(renamed.time.created).toBe(before.time.created)
        expect(renamed.time.updated).toBeGreaterThan(before.time.updated)
        expect(yield* labels.get(label.id)).toEqual(renamed)
      }),
    )

    it.effect("moves a label to a new parent and back to the top level", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const parent = yield* labels.create({ name: "Parent" })
        const label = yield* labels.create({ name: "Child" })

        expect((yield* labels.update(label.id, { parentID: parent.id })).parentID).toBe(parent.id)
        expect((yield* labels.update(label.id, { parentID: null })).parentID).toBeUndefined()
      }),
    )

    it.effect("keeps the label unchanged when the update is a no-op", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const label = yield* labels.create({ name: "Same" })
        expect(yield* labels.update(label.id, {})).toEqual(label)
        expect(yield* labels.update(label.id, { name: "Same" })).toEqual(label)
      }),
    )

    it.effect("fails to update a label that does not exist", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        expect(yield* failureTag(labels.update(missing, { name: "Anything" }))).toBe("Label.NotFoundError")
      }),
    )

    it.effect("fails to update a label after it has been deleted", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const label = yield* labels.create({ name: "Temporary" })
        yield* labels.remove(label.id)

        expect(yield* failureTag(labels.update(label.id, { name: "Revived" }))).toBe("Label.NotFoundError")
        expect(yield* labels.list()).toEqual([])
      }),
    )

    it.effect("rejects moving a label under a parent that does not exist", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const label = yield* labels.create({ name: "Label" })
        expect(yield* failureTag(labels.update(label.id, { parentID: missing }))).toBe("Label.NotFoundError")
      }),
    )

    it.effect("rejects moving a label under itself or one of its descendants", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const root = yield* labels.create({ name: "Root" })
        const child = yield* labels.create({ name: "Child", parentID: root.id })
        const grandchild = yield* labels.create({ name: "Grandchild", parentID: child.id })

        expect(yield* failureTag(labels.update(root.id, { parentID: root.id }))).toBe("Label.CycleError")
        expect(yield* failureTag(labels.update(root.id, { parentID: grandchild.id }))).toBe("Label.CycleError")
        expect((yield* labels.get(root.id)).parentID).toBeUndefined()
      }),
    )

    it.effect("rejects a rename or move that collides with a sibling", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const folder = yield* labels.create({ name: "Folder" })
        yield* labels.create({ name: "Taken" })
        const inside = yield* labels.create({ name: "Taken", parentID: folder.id })
        const other = yield* labels.create({ name: "Other" })

        expect(yield* failureTag(labels.update(other.id, { name: "TAKEN" }))).toBe("Label.DuplicateNameError")
        expect(yield* failureTag(labels.update(inside.id, { parentID: null }))).toBe("Label.DuplicateNameError")
      }),
    )
  })

  describe("remove", () => {
    it.effect("deletes a label", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const label = yield* labels.create({ name: "Delete me" })

        expect(yield* labels.remove(label.id)).toEqual([label.id])
        expect(yield* failureTag(labels.get(label.id))).toBe("Label.NotFoundError")
      }),
    )

    it.effect("deletes every descendant of a label and leaves other labels alone", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const root = yield* labels.create({ name: "Root" })
        const child = yield* labels.create({ name: "Child", parentID: root.id })
        const sibling = yield* labels.create({ name: "Sibling", parentID: root.id })
        const grandchild = yield* labels.create({ name: "Grandchild", parentID: child.id })
        const keep = yield* labels.create({ name: "Keep" })
        const keepChild = yield* labels.create({ name: "Keep child", parentID: keep.id })

        const removed = yield* labels.remove(root.id)
        expect(new Set(removed)).toEqual(new Set([root.id, child.id, sibling.id, grandchild.id]))
        expect(new Set((yield* labels.list()).map((label) => label.id))).toEqual(new Set([keep.id, keepChild.id]))
        expect(yield* labels.list({ parentID: keep.id })).toEqual([keepChild])
      }),
    )

    it.effect("fails to delete a label that does not exist or was already deleted", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        expect(yield* failureTag(labels.remove(missing))).toBe("Label.NotFoundError")

        const label = yield* labels.create({ name: "Once" })
        yield* labels.remove(label.id)
        expect(yield* failureTag(labels.remove(label.id))).toBe("Label.NotFoundError")
      }),
    )
  })

  describe("resolvePath", () => {
    it.effect("resolves a label and everything nested beneath it", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const coursework = yield* labels.create({ name: "Coursework" })
        const databases = yield* labels.create({ name: "Databases", parentID: coursework.id })
        const sql = yield* labels.create({ name: "SQL", parentID: databases.id })
        yield* labels.create({ name: "Personal" })

        expect([...(yield* labels.resolvePath("Coursework"))].sort()).toEqual(
          [coursework.id, databases.id, sql.id].sort(),
        )
        expect([...(yield* labels.resolvePath(" coursework / DATABASES "))].sort()).toEqual(
          [databases.id, sql.id].sort(),
        )
      }),
    )

    it.effect("matches a path starting at any depth and every label that shares the name", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const coursework = yield* labels.create({ name: "Coursework" })
        const research = yield* labels.create({ name: "Research" })
        const courseDatabases = yield* labels.create({ name: "Databases", parentID: coursework.id })
        const researchDatabases = yield* labels.create({ name: "Databases", parentID: research.id })

        expect([...(yield* labels.resolvePath("Databases"))].sort()).toEqual(
          [courseDatabases.id, researchDatabases.id].sort(),
        )
        expect(yield* labels.resolvePath("Research/Databases")).toEqual([researchDatabases.id])
      }),
    )

    it.effect("returns nothing for unknown or empty paths", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        yield* labels.create({ name: "Coursework" })

        expect(yield* labels.resolvePath("Missing")).toEqual([])
        expect(yield* labels.resolvePath("Missing/Coursework")).toEqual([])
        expect(yield* labels.resolvePath(" / ")).toEqual([])
      }),
    )
  })

  describe("session assignment", () => {
    it.effect("assigns labels to a session and lists them by name", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session, other] = yield* createSessions("ses_one", "ses_two")
        const work = yield* labels.create({ name: "Work" })
        const bugs = yield* labels.create({ name: "Bugs" })

        yield* labels.assign({ sessionID: session, labelID: work.id })
        yield* labels.assign({ sessionID: session, labelID: bugs.id })

        expect(yield* labels.forSession(session)).toEqual([bugs, work])
        expect(yield* labels.forSession(other)).toEqual([])
      }),
    )

    it.effect("ignores assigning the same label twice", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session] = yield* createSessions("ses_one")
        const work = yield* labels.create({ name: "Work" })

        yield* labels.assign({ sessionID: session, labelID: work.id })
        yield* labels.assign({ sessionID: session, labelID: work.id })

        expect(yield* labels.forSession(session)).toEqual([work])
      }),
    )

    it.effect("unassigns a label and ignores labels the session does not have", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session] = yield* createSessions("ses_one")
        const work = yield* labels.create({ name: "Work" })
        const bugs = yield* labels.create({ name: "Bugs" })
        yield* labels.assign({ sessionID: session, labelID: work.id })

        yield* labels.unassign({ sessionID: session, labelID: bugs.id })
        yield* labels.unassign({ sessionID: session, labelID: work.id })

        expect(yield* labels.forSession(session)).toEqual([])
      }),
    )

    it.effect("rejects a label or session that does not exist", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session] = yield* createSessions("ses_one")
        const work = yield* labels.create({ name: "Work" })

        expect(yield* failureTag(labels.assign({ sessionID: session, labelID: missing }))).toBe("Label.NotFoundError")
        expect(
          yield* failureTag(labels.assign({ sessionID: SessionSchema.ID.make("ses_missing"), labelID: work.id })),
        ).toBe("Label.SessionNotFoundError")
      }),
    )

    it.effect("drops assignments when a label or one of its ancestors is deleted", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session] = yield* createSessions("ses_one")
        const coursework = yield* labels.create({ name: "Coursework" })
        const databases = yield* labels.create({ name: "Databases", parentID: coursework.id })
        const keep = yield* labels.create({ name: "Keep" })
        yield* labels.assign({ sessionID: session, labelID: databases.id })
        yield* labels.assign({ sessionID: session, labelID: keep.id })

        yield* labels.remove(coursework.id)

        expect(yield* labels.forSession(session)).toEqual([keep])
      }),
    )

    it.effect("drops a session's assignments when the session is deleted", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const { db } = yield* Database.Service
        const [session, other] = yield* createSessions("ses_one", "ses_two")
        const work = yield* labels.create({ name: "Work" })
        yield* labels.assign({ sessionID: session, labelID: work.id })
        yield* labels.assign({ sessionID: other, labelID: work.id })

        yield* db.delete(SessionTable).where(eq(SessionTable.id, session)).run().pipe(Effect.orDie)

        expect(yield* labels.forSession(session)).toEqual([])
        expect(yield* labels.forSession(other)).toEqual([work])
      }),
    )

    it.effect("rejects assigning a label after it has been deleted", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const [session] = yield* createSessions("ses_one")
        const work = yield* labels.create({ name: "Work" })
        yield* labels.remove(work.id)

        expect(yield* failureTag(labels.assign({ sessionID: session, labelID: work.id }))).toBe("Label.NotFoundError")
        expect(yield* labels.forSession(session)).toEqual([])
      }),
    )

    it.effect("treats unassigning or listing an unknown session as a no-op", () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const work = yield* labels.create({ name: "Work" })
        const ghost = SessionSchema.ID.make("ses_missing")

        yield* labels.unassign({ sessionID: ghost, labelID: work.id })
        expect(yield* labels.forSession(ghost)).toEqual([])
      }),
    )
  })
})
