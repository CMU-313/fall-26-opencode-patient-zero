import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import {
  createDialogSessionListQuery,
  loadDialogSessionList,
  parseSessionListCommand,
  parseSessionSearch,
  selectSessionListResults,
} from "../../src/component/dialog-session-list"

const session = (id: string, title: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/",
  title,
  version: "1",
  time: { created: 0, updated: 0 },
})

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

  describe("selectSessionListResults", () => {
    const browse = [session("a", "deploy fix"), session("b", "release notes")]
    const synced = [...browse, session("current", "current session"), session("pinned", "pinned session")]

    test("falls back from search to browse to synced sessions for an ordinary search", () => {
      expect(
        selectSessionListResults({
          search: "",
          searchResults: undefined,
          browseResults: browse,
          syncSessions: synced,
          extraIDs: [],
          deletedIDs: new Set(),
        }).map((s) => s.id),
      ).toEqual(["a", "b"])

      expect(
        selectSessionListResults({
          search: "",
          searchResults: undefined,
          browseResults: undefined,
          syncSessions: synced,
          extraIDs: [],
          deletedIDs: new Set(),
        }).map((s) => s.id),
      ).toEqual(["a", "b", "current", "pinned"])
    })

    test("reintroduces the current and pinned sessions for an ordinary search but not a label search", () => {
      const withExtras = selectSessionListResults({
        search: "",
        searchResults: [session("a", "deploy fix")],
        browseResults: browse,
        syncSessions: synced,
        extraIDs: ["current", "pinned"],
        deletedIDs: new Set(),
      }).map((s) => s.id)
      expect(withExtras.sort()).toEqual(["a", "current", "pinned"].sort())

      const labelSearch = selectSessionListResults({
        search: "label:Coursework",
        searchResults: [session("a", "deploy fix")],
        browseResults: browse,
        syncSessions: synced,
        extraIDs: ["current", "pinned"],
        deletedIDs: new Set(),
      }).map((s) => s.id)
      expect(labelSearch).toEqual(["a"])
    })

    test("uses only server results for a label search, never the browse or synced fallback", () => {
      expect(
        selectSessionListResults({
          search: "label:Coursework",
          searchResults: undefined,
          browseResults: browse,
          syncSessions: synced,
          extraIDs: ["current", "pinned"],
          deletedIDs: new Set(),
        }),
      ).toEqual([])
    })

    test("keeps an empty label result empty rather than reintroducing local sessions", () => {
      expect(
        selectSessionListResults({
          search: "label:Coursework",
          searchResults: [],
          browseResults: browse,
          syncSessions: synced,
          extraIDs: ["current", "pinned"],
          deletedIDs: new Set(),
        }),
      ).toEqual([])
    })

    test("restores the normal fallback once the label filter is removed", () => {
      const labeled = selectSessionListResults({
        search: "label:Coursework",
        searchResults: [],
        browseResults: browse,
        syncSessions: synced,
        extraIDs: ["current", "pinned"],
        deletedIDs: new Set(),
      })
      const cleared = selectSessionListResults({
        search: "",
        searchResults: undefined,
        browseResults: browse,
        syncSessions: synced,
        extraIDs: ["current", "pinned"],
        deletedIDs: new Set(),
      })
      expect(labeled).toEqual([])
      expect(cleared.map((s) => s.id).sort()).toEqual(["a", "b", "current", "pinned"].sort())
    })

    test("still applies a combined title filter on top of label results", () => {
      expect(
        selectSessionListResults({
          search: "label:Coursework deploy",
          searchResults: [session("a", "deploy fix"), session("b", "release notes")],
          browseResults: browse,
          syncSessions: synced,
          extraIDs: [],
          deletedIDs: new Set(),
        }).map((s) => s.id),
      ).toEqual(["a"])
    })

    test("excludes deleted sessions regardless of filter mode", () => {
      expect(
        selectSessionListResults({
          search: "",
          searchResults: undefined,
          browseResults: browse,
          syncSessions: synced,
          extraIDs: [],
          deletedIDs: new Set(["a"]),
        }).map((s) => s.id),
      ).toEqual(["b"])
    })
  })
})
