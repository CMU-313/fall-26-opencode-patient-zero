import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { array, assert, asyncProperty, boolean, constantFrom, nat, record, uniqueArray } from "fast-check"
import { eq } from "drizzle-orm"
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

// Generators use short non-empty lowercase names for valid labels, uniqueArray to force multiple-label cases,
// bounded operation sequences over three sessions and four labels for repeated assignments and removals, and
// exact or uppercase variants to exercise duplicate-name boundaries.
const propertyOptions = { numRuns: 50, seed: 42 }
const labelName = array(constantFrom(...Array.from("abcdefghijklmnopqrstuvwxyz")), {
  minLength: 1,
  maxLength: 8,
}).map((characters) => characters.join(""))

const createSessions = (...ids: string[]) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const projectID = ProjectV2.ID.make("prj_label_properties")
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

const failureTag = <A, E extends { _tag: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error._tag),
  )

const scopedName = (requirement: string, run: number, index: number, name: string) =>
  `${requirement}_${run}_${index}_${name}`

describe("Label properties", () => {
  // R1: A session must be able to have multiple independent labels.
  // Kind: round-trip
  it.effect("R1: independent labels survive assigning and unassigning one label", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const database = yield* Database.Service
      let run = 0

      yield* Effect.promise(() =>
        assert(
          asyncProperty(uniqueArray(labelName, { minLength: 2, maxLength: 5 }), async (names) => {
            const currentRun = run++
            const [sessionID] = await Effect.runPromise(
              createSessions(`ses_r1_${currentRun}`).pipe(Effect.provideService(Database.Service, database)),
            )
            const created = await Effect.runPromise(
              Effect.all(
                names.map((name, index) => labels.create({ name: scopedName("r1", currentRun, index, name) })),
              ),
            )
            const baseline = created.slice(1)

            await Effect.runPromise(
              Effect.all(baseline.map((label) => labels.assign({ sessionID, labelID: label.id }))),
            )
            await Effect.runPromise(labels.assign({ sessionID, labelID: created[0]!.id }))
            await Effect.runPromise(labels.unassign({ sessionID, labelID: created[0]!.id }))

            expect(new Set((await Effect.runPromise(labels.forSession(sessionID))).map((label) => label.id))).toEqual(
              new Set(baseline.map((label) => label.id)),
            )
          }),
          propertyOptions,
        ),
      )
    }),
  )

  // R2: Assigning or unassigning a label should only change session-label relationships.
  // Kind: invariant
  it.effect("R2: label operations preserve session records", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const database = yield* Database.Service
      const { db } = database
      let run = 0

      yield* Effect.promise(() =>
        assert(
          asyncProperty(uniqueArray(labelName, { minLength: 1, maxLength: 4 }), async (names) => {
            const currentRun = run++
            const [sessionID] = await Effect.runPromise(
              createSessions(`ses_r2_${currentRun}`).pipe(Effect.provideService(Database.Service, database)),
            )
            const created = await Effect.runPromise(
              Effect.all(
                names.map((name, index) => labels.create({ name: scopedName("r2", currentRun, index, name) })),
              ),
            )
            const beforeSession = await Effect.runPromise(
              db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
            )
            const beforeSessionIDs = await Effect.runPromise(
              db.select({ id: SessionTable.id }).from(SessionTable).all(),
            )
            const missingSessionID = SessionSchema.ID.make(`ses_r2_missing_${currentRun}`)
            const missingSessionError = await Effect.runPromise(
              Effect.flip(labels.assign({ sessionID: missingSessionID, labelID: created[0]!.id })),
            )
            expect(missingSessionError).toMatchObject({
              _tag: "Label.SessionNotFoundError",
              sessionID: missingSessionID,
            })

            await Effect.runPromise(Effect.all(created.map((label) => labels.assign({ sessionID, labelID: label.id }))))
            await Effect.runPromise(Effect.all(created.map((label) => labels.assign({ sessionID, labelID: label.id }))))
            expect(
              await Effect.runPromise(db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()),
            ).toEqual(beforeSession)
            expect(await Effect.runPromise(db.select({ id: SessionTable.id }).from(SessionTable).all())).toEqual(
              beforeSessionIDs,
            )

            await Effect.runPromise(
              Effect.all(created.map((label) => labels.unassign({ sessionID, labelID: label.id }))),
            )
            expect(
              await Effect.runPromise(db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get()),
            ).toEqual(beforeSession)
            expect(await Effect.runPromise(db.select({ id: SessionTable.id }).from(SessionTable).all())).toEqual(
              beforeSessionIDs,
            )
            expect(await Effect.runPromise(labels.forSession(sessionID))).toEqual([])
          }),
          propertyOptions,
        ),
      )
    }),
  )

  // R4: Label assignments should remain and persist across and between sessions.
  // Kind: oracle
  it.effect("R4: assigned labels agree with a session-label model after fresh reads", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const database = yield* Database.Service
      let run = 0

      yield* Effect.promise(() =>
        assert(
          asyncProperty(
            array(record({ session: nat(2), label: nat(3), assign: boolean() }), { minLength: 1, maxLength: 12 }),
            async (operations) => {
              const currentRun = run++
              const sessions = await Effect.runPromise(
                createSessions(`ses_r4_${currentRun}_0`, `ses_r4_${currentRun}_1`, `ses_r4_${currentRun}_2`).pipe(
                  Effect.provideService(Database.Service, database),
                ),
              )
              const created = await Effect.runPromise(
                Effect.all(
                  Array.from({ length: 4 }, (_, index) =>
                    labels.create({ name: scopedName("r4", currentRun, index, `label${index}`) }),
                  ),
                ),
              )
              const expected = new Map(sessions.map((sessionID) => [sessionID, new Set<Label.ID>()] as const))

              for (const operation of operations) {
                const sessionID = sessions[operation.session]!
                const labelID = created[operation.label]!.id
                const input = { sessionID, labelID }
                const sessionLabels = expected.get(sessionID)!
                if (operation.assign) {
                  await Effect.runPromise(labels.assign(input))
                  sessionLabels.add(labelID)
                }
                if (!operation.assign) {
                  await Effect.runPromise(labels.unassign(input))
                  sessionLabels.delete(labelID)
                }

                expect(
                  new Set((await Effect.runPromise(labels.forSession(sessionID))).map((label) => label.id)),
                ).toEqual(sessionLabels)
              }
            },
          ),
          propertyOptions,
        ),
      )
    }),
  )

  // R7: Labels cannot be created with the same name as an existing label.
  // Kind: invariant
  it.effect("R7: case variants cannot create duplicate labels", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      let run = 0

      yield* Effect.promise(() =>
        assert(
          asyncProperty(labelName, array(boolean(), { minLength: 1, maxLength: 4 }), async (baseName, attempts) => {
            const currentRun = run++
            const name = scopedName("r7", currentRun, 0, baseName)
            const created = await Effect.runPromise(labels.create({ name }))
            const failures = await Effect.runPromise(
              Effect.all(
                attempts.map((uppercase) =>
                  failureTag(labels.create({ name: uppercase ? name.toUpperCase() : name.toLowerCase() })),
                ),
              ),
            )

            expect(failures).toEqual(attempts.map(() => "Label.DuplicateNameError"))
            const parent = await Effect.runPromise(
              labels.create({ name: scopedName("r7_parent", currentRun, 0, "parent") }),
            )
            const nestedName = scopedName("r7_nested", currentRun, 0, baseName)
            await Effect.runPromise(labels.create({ name: nestedName, parentID: parent.id }))
            const nestedFailures = await Effect.runPromise(
              Effect.all(
                attempts.map((uppercase) =>
                  failureTag(
                    labels.create({
                      name: uppercase ? nestedName.toUpperCase() : nestedName.toLowerCase(),
                      parentID: parent.id,
                    }),
                  ),
                ),
              ),
            )
            expect(nestedFailures).toEqual(attempts.map(() => "Label.DuplicateNameError"))
            const matches = (await Effect.runPromise(labels.list())).filter(
              (label) => label.name.toLowerCase() === name.toLowerCase(),
            )
            expect(matches).toEqual([created])
          }),
          propertyOptions,
        ),
      )
    }),
  )
})
