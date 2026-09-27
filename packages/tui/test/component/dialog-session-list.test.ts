import { describe, expect, test } from "bun:test"
import {
  createDialogSessionListQuery,
  loadDialogSessionList,
  parseSessionListCommand,
  parseSessionSearch,
} from "../../src/component/dialog-session-list"

describe("dialog session list", () => {
  test("requests root sessions for the default browse list", () => {
    expect(createDialogSessionListQuery({ filter: { path: "packages/tui" } })).toEqual({
      roots: true,
      limit: 100,
      path: "packages/tui",
    })
  })

  test("requests root sessions for search results", () => {
    expect(createDialogSessionListQuery({ search: " deploy ", filter: { scope: "project" } })).toEqual({
      roots: true,
      limit: 30,
      search: "deploy",
      scope: "project",
    })
  })

  test("sends a label filter alongside title words", () => {
    expect(createDialogSessionListQuery({ search: "exam label:Coursework/Databases review", filter: {} })).toEqual({
      roots: true,
      limit: 30,
      search: "exam review",
      label: "Coursework/Databases",
    })
    expect(createDialogSessionListQuery({ search: "label:Coursework", filter: {} })).toEqual({
      roots: true,
      limit: 30,
      label: "Coursework",
    })
  })

  test("parses quoted and incomplete label filters", () => {
    expect(parseSessionSearch('label:"Machine Learning/Week 1" notes')).toEqual({
      title: "notes",
      label: "Machine Learning/Week 1",
    })
    expect(parseSessionSearch('LABEL:"Machine Lea')).toEqual({ title: "", label: "Machine Lea" })
    expect(parseSessionSearch("label:")).toEqual({ title: "", label: undefined })
    expect(parseSessionSearch("relabel:x")).toEqual({ title: "relabel:x", label: undefined })
  })

  test("reads search text after /sessions and its aliases", () => {
    expect(parseSessionListCommand("/sessions label:Coursework")).toEqual({
      command: "sessions",
      search: "label:Coursework",
    })
    expect(parseSessionListCommand("  /resume deploy fix ")).toEqual({ command: "resume", search: "deploy fix" })
    expect(parseSessionListCommand("/sessions")).toBeUndefined()
    expect(parseSessionListCommand("/review label:x")).toBeUndefined()
    expect(parseSessionListCommand("please /sessions x")).toBeUndefined()
  })

  test("keeps the cache usable while the root request is pending", async () => {
    let resolve!: (result: { data: string[] }) => void
    const pending = loadDialogSessionList<string>({
      filter: {},
      list: () => new Promise((done) => (resolve = done)),
    })

    expect(await Promise.race([pending, Promise.resolve("pending")])).toBe("pending")
    resolve({ data: ["root"] })
    expect(await pending).toEqual(["root"])
  })

  test("falls back when the root request returns an error response", async () => {
    expect(await loadDialogSessionList({ filter: {}, list: async () => ({}) })).toBeUndefined()
  })

  test("falls back when the root request rejects", async () => {
    expect(
      await loadDialogSessionList({
        filter: {},
        list: () => Promise.reject(new Error("offline")),
      }),
    ).toBeUndefined()
  })
})
