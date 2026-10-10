import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { webHandler } from "@opencode-ai/server/routes"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

type Label = { id: string; name: string; parentID?: string }

const context = Context.empty() as Context.Context<unknown>

function request(route: string, init: RequestInit = {}) {
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, init), context)
}

function send(method: string, route: string, body?: unknown) {
  return request(route, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function create(name: string, parentID?: string) {
  const response = await send("POST", "/api/label", { name, parentID })
  expect(response.status).toBe(200)
  return ((await response.json()) as { data: Label }).data
}

async function list(query = "") {
  const response = await request(`/api/label${query}`)
  expect(response.status).toBe(200)
  return ((await response.json()) as { data: Label[] }).data
}

async function names(query = "") {
  return (await list(query)).map((label) => label.name)
}

afterEach(async () => {
  // Tests share one in-memory database, so clear every label tree between tests.
  await Promise.all((await list("?parentID=root")).map((label) => send("DELETE", `/api/label/${label.id}`)))
  await disposeAllInstances()
  await resetDatabase()
})

describe("v2 label HttpApi", () => {
  describe("POST /api/label", () => {
    test("creates a top-level label with a trimmed name and omits parentID", async () => {
      const response = await send("POST", "/api/label", { name: "  Coursework  " })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { data: Label & { time: { created: number; updated: number } } }

      expect(body.data.id).toStartWith("lbl_")
      expect(body.data.name).toBe("Coursework")
      expect(body.data).not.toHaveProperty("parentID")
      expect(body.data.time.created).toBeNumber()
      expect(body.data.time.updated).toBe(body.data.time.created)
    })

    test("creates a nested label under an existing parent", async () => {
      const coursework = await create("Coursework")
      const databases = await create("Databases", coursework.id)
      expect(databases.parentID).toBe(coursework.id)
    })

    test("returns 404 when the parent does not exist", async () => {
      const response = await send("POST", "/api/label", { name: "Orphan", parentID: "lbl_missing" })
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ _tag: "LabelNotFoundError", labelID: "lbl_missing" })
    })

    test("returns 400 for empty and overly long names", async () => {
      for (const name of ["   ", "x".repeat(65)]) {
        const response = await send("POST", "/api/label", { name })
        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          _tag: "InvalidRequestError",
          kind: "invalid_name",
          field: "name",
        })
      }
      expect(await names()).toEqual([])
    })

    test("returns 400 when the payload does not match the schema", async () => {
      expect((await send("POST", "/api/label", {})).status).toBe(400)
      expect((await send("POST", "/api/label", { name: 42 })).status).toBe(400)
    })

    test("returns 409 for a case-insensitive duplicate sibling name but allows it at another level", async () => {
      const coursework = await create("Coursework")

      const duplicate = await send("POST", "/api/label", { name: "coursework" })
      expect(duplicate.status).toBe(409)
      expect(await duplicate.json()).toMatchObject({ _tag: "ConflictError", resource: "label" })

      expect((await create("Coursework", coursework.id)).parentID).toBe(coursework.id)
    })
  })

  describe("GET /api/label", () => {
    test("lists every label, top-level labels, or one label's children, sorted by name", async () => {
      const coursework = await create("Coursework")
      await create("Networks", coursework.id)
      await create("Databases", coursework.id)
      await create("Personal")

      expect(await names()).toEqual(["Coursework", "Databases", "Networks", "Personal"])
      expect(await names("?parentID=root")).toEqual(["Coursework", "Personal"])
      expect(await names(`?parentID=${coursework.id}`)).toEqual(["Databases", "Networks"])
    })

    test("returns an empty list when there are no labels or the parent has no children", async () => {
      expect(await list()).toEqual([])
      const leaf = await create("Leaf")
      expect(await list(`?parentID=${leaf.id}`)).toEqual([])
    })
  })

  describe("GET /api/label/:labelID", () => {
    test("returns one label", async () => {
      const coursework = await create("Coursework")
      const databases = await create("Databases", coursework.id)

      const response = await request(`/api/label/${databases.id}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        data: { id: databases.id, name: "Databases", parentID: coursework.id },
      })
    })

    test("returns 404 for a label that does not exist", async () => {
      const response = await request("/api/label/lbl_missing")
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({
        _tag: "LabelNotFoundError",
        labelID: "lbl_missing",
        message: "Label lbl_missing does not exist",
      })
    })
  })

  describe("PATCH /api/label/:labelID", () => {
    test("renames a label and keeps its parent", async () => {
      const coursework = await create("Coursework")
      const databases = await create("Databases", coursework.id)

      const response = await send("PATCH", `/api/label/${databases.id}`, { name: "SQL" })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { id: databases.id, name: "SQL", parentID: coursework.id } })
      expect(await names(`?parentID=${coursework.id}`)).toEqual(["SQL"])
    })

    test("moves a label under a new parent, then to the top level with parentID null", async () => {
      const coursework = await create("Coursework")
      const personal = await create("Personal")
      const notes = await create("Notes", coursework.id)

      const moved = await send("PATCH", `/api/label/${notes.id}`, { parentID: personal.id })
      expect(moved.status).toBe(200)
      expect(await names(`?parentID=${personal.id}`)).toEqual(["Notes"])
      expect(await names(`?parentID=${coursework.id}`)).toEqual([])

      const top = await send("PATCH", `/api/label/${notes.id}`, { parentID: null })
      expect(top.status).toBe(200)
      expect(((await top.json()) as { data: Label }).data).not.toHaveProperty("parentID")
      expect(await names("?parentID=root")).toEqual(["Coursework", "Notes", "Personal"])
    })

    test("returns 404 for a missing label or a missing new parent", async () => {
      expect((await send("PATCH", "/api/label/lbl_missing", { name: "Renamed" })).status).toBe(404)

      const label = await create("Coursework")
      const response = await send("PATCH", `/api/label/${label.id}`, { parentID: "lbl_missing" })
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ _tag: "LabelNotFoundError", labelID: "lbl_missing" })
    })

    test("returns 400 for an invalid new name", async () => {
      const label = await create("Coursework")
      const response = await send("PATCH", `/api/label/${label.id}`, { name: "" })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ _tag: "InvalidRequestError", field: "name" })
    })

    test("returns 409 for a rename that collides with a sibling", async () => {
      await create("Coursework")
      const personal = await create("Personal")
      const response = await send("PATCH", `/api/label/${personal.id}`, { name: "COURSEWORK" })
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ _tag: "ConflictError", resource: "label" })
    })

    test("returns 409 when moving a label under itself or one of its descendants", async () => {
      const coursework = await create("Coursework")
      const databases = await create("Databases", coursework.id)
      const week1 = await create("Week 1", databases.id)

      for (const parentID of [coursework.id, week1.id]) {
        const response = await send("PATCH", `/api/label/${coursework.id}`, { parentID })
        expect(response.status).toBe(409)
        expect(((await response.json()) as { message: string }).message).toContain("cycle")
      }
      expect(await names("?parentID=root")).toEqual(["Coursework"])
    })
  })

  describe("DELETE /api/label/:labelID", () => {
    test("removes a label with all its descendants, returns their IDs, and leaves other labels alone", async () => {
      const coursework = await create("Coursework")
      const databases = await create("Databases", coursework.id)
      const week1 = await create("Week 1", databases.id)
      await create("Personal")

      const response = await send("DELETE", `/api/label/${coursework.id}`)
      expect(response.status).toBe(200)
      const body = (await response.json()) as { data: string[] }
      expect(body.data.toSorted()).toEqual([coursework.id, databases.id, week1.id].toSorted())
      expect(await names()).toEqual(["Personal"])
    })

    test("returns 404 for every operation on a deleted label", async () => {
      const label = await create("Coursework")
      expect((await send("DELETE", `/api/label/${label.id}`)).status).toBe(200)

      for (const [method, body] of [
        ["GET", undefined],
        ["PATCH", { name: "Renamed" }],
        ["DELETE", undefined],
      ] as const) {
        const response = await send(method, `/api/label/${label.id}`, body)
        expect(response.status).toBe(404)
        expect(await response.json()).toMatchObject({ _tag: "LabelNotFoundError", labelID: label.id })
      }
    })
  })

  test("the generated SDK client calls every label endpoint", async () => {
    const sdk = createOpencodeClient({
      baseUrl: "http://localhost",
      fetch: ((input: Request) => HttpApiApp.webHandler().handler(input, context)) as unknown as typeof fetch,
    })

    const coursework = await sdk.v2.label.create({ name: "Coursework" })
    expect(coursework.response.status).toBe(200)
    const parentID = coursework.data!.data.id
    const databases = await sdk.v2.label.create({ name: "Databases", parentID })
    const childID = databases.data!.data.id

    expect((await sdk.v2.label.list({ parentID: "root" })).data?.data.map((label) => label.name)).toEqual([
      "Coursework",
    ])
    expect((await sdk.v2.label.get({ labelID: childID })).data?.data.parentID).toBe(parentID)
    expect((await sdk.v2.label.update({ labelID: childID, name: "SQL" })).data?.data.name).toBe("SQL")
    expect((await sdk.v2.label.remove({ labelID: parentID })).data?.data.toSorted()).toEqual(
      [parentID, childID].toSorted(),
    )

    const missing = await sdk.v2.label.get({ labelID: childID })
    expect(missing.response.status).toBe(404)
    expect(missing.error).toMatchObject({ _tag: "LabelNotFoundError" })
  })

  test("the standalone server also serves label routes", async () => {
    const handler = webHandler()
    const created = await handler.handler(
      new Request("http://localhost/api/label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Standalone" }),
      }),
      context,
    )
    expect(created.status).toBe(200)
    const label = ((await created.json()) as { data: Label }).data

    const fetched = await handler.handler(new Request(`http://localhost/api/label/${label.id}`), context)
    expect(fetched.status).toBe(200)
    expect(await fetched.json()).toMatchObject({ data: { id: label.id, name: "Standalone" } })
    await handler.dispose()
  })
})
