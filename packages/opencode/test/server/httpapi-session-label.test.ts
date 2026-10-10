import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Session } from "@/session/session"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { httpApiLayer, request } from "./httpapi-layer"

type Label = { id: string; name: string }

const it = testEffect(Layer.mergeAll(LayerNode.compile(Session.node), httpApiLayer))

function send(method: string, route: string, body?: unknown) {
  return request(route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Sends a request and returns its status with the decoded JSON body. */
const call = (method: string, route: string, body?: unknown) =>
  Effect.gen(function* () {
    const response = yield* send(method, route, body)
    return { status: response.status, body: yield* response.json }
  })

const createLabel = (name: string) =>
  call("POST", "/api/label", { name }).pipe(Effect.map((result) => (result.body as { data: Label }).data))

/** Returns the names of the labels in a session label response. */
const names = (body: unknown) => (body as { data: Label[] }).data.map((label) => label.name)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("session label HttpApi", () => {
  it.instance(
    "assigns, lists, and unassigns labels on a session",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.use.create({ title: "labeled" })
        const work = yield* createLabel("Work")
        const bugs = yield* createLabel("Bugs")
        const route = `/api/session/${session.id}/label`

        expect(yield* call("GET", route)).toEqual({ status: 200, body: { data: [] } })

        const assigned = yield* call("PUT", `${route}/${work.id}`)
        expect(assigned.status).toBe(200)
        expect(names(assigned.body)).toEqual(["Work"])

        yield* call("PUT", `${route}/${bugs.id}`)
        const listed = yield* call("GET", route)
        expect(listed.status).toBe(200)
        expect(names(listed.body)).toEqual(["Bugs", "Work"])

        const unassigned = yield* call("DELETE", `${route}/${work.id}`)
        expect(unassigned.status).toBe(200)
        expect(names(unassigned.body)).toEqual(["Bugs"])
      }),
    { git: true },
  )

  it.instance(
    "ignores assigning a label twice and unassigning a label the session does not have",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.use.create({ title: "labeled" })
        const work = yield* createLabel("Work")
        const bugs = yield* createLabel("Bugs")
        const route = `/api/session/${session.id}/label`

        yield* call("PUT", `${route}/${work.id}`)
        const again = yield* call("PUT", `${route}/${work.id}`)
        expect(again.status).toBe(200)
        expect(names(again.body)).toEqual(["Work"])

        const missing = yield* call("DELETE", `${route}/${bugs.id}`)
        expect(missing.status).toBe(200)
        expect(names(missing.body)).toEqual(["Work"])
      }),
    { git: true },
  )

  it.instance(
    "returns 404 for a missing or deleted label and a missing session",
    () =>
      Effect.gen(function* () {
        const session = yield* Session.use.create({ title: "labeled" })
        const work = yield* createLabel("Work")
        const deleted = yield* createLabel("Deleted")
        yield* call("DELETE", `/api/label/${deleted.id}`)

        for (const labelID of ["lbl_missing", deleted.id]) {
          const result = yield* call("PUT", `/api/session/${session.id}/label/${labelID}`)
          expect(result.status).toBe(404)
          expect(result.body).toMatchObject({ _tag: "LabelNotFoundError", labelID })
        }

        const result = yield* call("PUT", `/api/session/ses_missing/label/${work.id}`)
        expect(result.status).toBe(404)
        expect(result.body).toMatchObject({ _tag: "SessionNotFoundError", sessionID: "ses_missing" })
        expect(names((yield* call("GET", `/api/session/${session.id}/label`)).body)).toEqual([])
      }),
    { git: true },
  )
})
