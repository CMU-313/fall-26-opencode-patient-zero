// Property tests for the agent step-limit CONFIG requirements (R2, R4).
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import fc from "fast-check"
import { Effect, Logger, Option, Schema } from "effect"
import { type ParseError, parse as parseJsonc } from "jsonc-parser"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigAgent } from "@opencode-ai/core/config/agent"
import { ConfigAgentPlugin } from "@opencode-ai/core/config/plugin/agent"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { tmpdir } from "../fixture/tmpdir"
import { agentHost, host } from "../plugin/host"

// ---------- Shared setup ----------

// Same services the existing agent config tests use (test/config/agent.test.ts).
// A fresh layer is built for every generated case, so no agent state leaks between runs.
const layer = AppNodeBuilder.build(LayerNode.group([AgentV2.node, FSUtil.node, Global.node]))

// Mirrors Config's loadFile() in src/config.ts, which is not exported: parse JSONC with the
// same options, detect the V1 shape ("agent" key), migrate it, then decode with the same options.
const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const
const decodeInfo = Schema.decodeUnknownOption(Config.Info, decodeOptions)
const decodeV1Info = Schema.decodeUnknownOption(ConfigV1.Info, decodeOptions)
function loadJsonc(text: string) {
  const errors: ParseError[] = []
  const input: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error(`generated opencode.jsonc did not parse: ${text}`)
  const info = Option.getOrUndefined(
    ConfigMigrateV1.isV1(input)
      ? decodeV1Info(input).pipe(Option.map(ConfigMigrateV1.migrate), Option.flatMap(decodeInfo))
      : decodeInfo(input),
  )
  if (!info) throw new Error(`generated opencode.jsonc did not decode: ${text}`)
  return new Config.Document({ type: "document", info })
}

type JsoncStyle = { shape: "v1" | "v2"; comment: boolean; trailingComma: boolean }

// Writes the given Markdown agent files into <tmp>/agents/ (tmp plays the role of the project's
// .opencode directory), loads them plus optional opencode.jsonc text through the real
// ConfigAgentPlugin, and returns the resulting agents and every log message emitted while loading.
const loadAgents = (files: Record<string, string>, jsonc?: string) => {
  const logs: string[] = []
  const captureLogs = Logger.layer(
    [
      Logger.make((options) => {
        const message = options.message
        logs.push(Array.isArray(message) ? message.map(String).join(" ") : String(message))
      }),
    ],
    { mergeWithExisting: false },
  )
  return Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    )
    yield* Effect.promise(async () => {
      await fs.mkdir(path.join(tmp.path, "agents"), { recursive: true })
      for (const [name, content] of Object.entries(files)) {
        await fs.writeFile(path.join(tmp.path, "agents", `${name}.md`), content)
      }
    })
    const agents = yield* AgentV2.Service
    const config = Config.Service.of({
      entries: () =>
        Effect.succeed([
          ...(jsonc === undefined ? [] : [loadJsonc(jsonc)]),
          new Config.Directory({ type: "directory", path: AbsolutePath.make(tmp.path) }),
        ]),
    })
    yield* ConfigAgentPlugin.Plugin.effect(host({ agent: agentHost(agents) })).pipe(
      Effect.provideService(Config.Service, config),
    )
    const result: Record<string, { readonly steps?: number } | undefined> = {}
    for (const name of [...Object.keys(files), "b"]) result[name] = yield* agents.get(AgentV2.ID.make(name))
    return { agents: result, logs }
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.provide(captureLogs), Effect.runPromise)
}

// ---------- Generators ----------

// Invalid steps values. Interviewees tried -2 (C-7, O-1); the P3 acceptance criteria named
// 0, 2.5 and "five". Each family is covered, plus JS traps a hand-written example would
// miss: NaN, +/-Infinity, numeric strings like "3", null and booleans.
const invalidSteps = fc.oneof(
  fc.integer({ max: 0 }), // 0 and negatives
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)), // 2.5 ...
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.oneof(fc.constantFrom("five", "3", ""), fc.string()), // words, numeric strings, anything
  fc.constantFrom(null, true, false),
)

// The same invalid families, written as YAML frontmatter scalars (what a user types in an
// agent .md file). Strings are double-quoted so "3" stays a string, not the number 3.
const invalidYamlSteps = fc.oneof(
  fc.integer({ min: -1_000, max: 0 }).map(String),
  fc.constantFrom("2.5", "0.1", "-2.5", "1e-3"),
  fc.constantFrom(".nan", ".inf", "-.inf"),
  fc.constantFrom('"five"', '"3"', "five", "null", "true", "false"),
)

// Any valid limit. Small values (1-10) are what interviewees and the P3 acceptance criteria
// used (steps: 3); the second range reaches large values too.
const validSteps = fc.oneof(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 1_000_000 }))

// How a Markdown agent file writes its fields. Each choice takes a different code path in
// src/config/plugin/agent.ts decode():
//  - "native":       only v2 keys, so it decodes with ConfigAgent.Info
//  - "legacy-extra": adds a key outside the v2 set (temperature), which switches the file to
//                    the legacy ConfigAgentV1 decoder + ConfigMigrateV1.migrateAgent
//  - "legacy-max":   the deprecated maxSteps key, which only the legacy path maps to steps
const markdownStyle = fc.constantFrom("native", "legacy-extra", "legacy-max")

// How opencode.jsonc writes the limit. "v1" uses the documented `"agent": {...}` key, which
// Config detects as the V1 format and migrates; "v2" uses `"agents": {...}` directly.
// Comments and trailing commas are legal JSONC, so we sometimes add them.
const jsoncStyle: fc.Arbitrary<JsoncStyle> = fc.record({
  shape: fc.constantFrom("v1" as const, "v2" as const),
  comment: fc.boolean(),
  trailingComma: fc.boolean(),
})

function markdownFile(stepsYaml: string, style: string) {
  const front =
    style === "native"
      ? `steps: ${stepsYaml}`
      : style === "legacy-extra"
        ? `steps: ${stepsYaml}\ntemperature: 0.5`
        : `maxSteps: ${stepsYaml}`
  return `---\ndescription: Reads the chain files\n${front}\n---\nRead the chain files in order.`
}

function jsoncFile(steps: number, style: JsoncStyle) {
  const key = style.shape === "v1" ? "agent" : "agents"
  const comment = style.comment ? "  // step limit for agent b\n" : ""
  const comma = style.trailingComma ? "," : ""
  return `{\n  "${key}": {\n    "b": {\n      "description": "Reads the chain files",\n${comment}      "steps": ${steps}${comma}\n    }${comma}\n  }${comma}\n}`
}

const decodeAgent = Schema.decodeUnknownSync(ConfigAgent.Info)

describe("agent steps config properties", () => {
  // R2: OpenCode rejects a steps value that is not a positive whole number and shows an
  // error naming the field, instead of loading the agent.
  // Kind: invariant. (Schema level: for every invalid value, decoding fails and the error names steps.)
  test("R2 (schema): every invalid steps value is rejected with an error naming steps", () => {
    fc.assert(
      fc.property(invalidSteps, (steps) => {
        let message: string | undefined
        try {
          decodeAgent({ steps })
        } catch (error) {
          message = String(error)
        }
        expect(message).toBeDefined()
        expect(message).toContain("steps")
      }),
    )
  })

  // R2: OpenCode rejects a steps value that is not a positive whole number and shows an
  // error naming the field, instead of loading the agent.
  // Kind: invariant. (User level: for every invalid value in an agent .md file, through the real
  // plugin, the agent is not loaded, a message naming steps is reported, and a valid agent next
  // to it still loads, so one bad file doesn't take the others down.)
  test(
    "R2 (markdown): an agent file with invalid steps is not loaded and an error naming steps is reported",
    async () => {
      await fc.assert(
        fc.asyncProperty(invalidYamlSteps, markdownStyle, async (stepsYaml, style) => {
          const { agents, logs } = await loadAgents({
            bad: markdownFile(stepsYaml, style),
            good: markdownFile("3", "native"),
          })
          expect(agents.bad).toBeUndefined()
          expect(agents.good?.steps).toBe(3)
          expect(logs.some((line) => line.includes("bad") && line.includes("steps"))).toBe(true)
        }),
        { numRuns: 40 },
      )
    },
    60_000,
  )

  // R4: A steps value set in an agent Markdown file and the same value set in
  // opencode.jsonc produce the same limit.
  // Kind: metamorphic. Moving the limit from one config source to the other (and changing
  // how each source spells it) must not change the agent's resulting step limit.
  test(
    "R4: the same steps value in Markdown and in opencode.jsonc gives the same limit",
    async () => {
      await fc.assert(
        fc.asyncProperty(validSteps, markdownStyle, jsoncStyle, async (steps, md, jsonc) => {
          const { agents } = await loadAgents({ a: markdownFile(String(steps), md) }, jsoncFile(steps, jsonc))
          // Equal to each other (the requirement) and equal to N, so "both undefined"
          // (both silently dropped) can't pass by accident.
          expect(agents.a?.steps).toBe(agents.b?.steps)
          expect(agents.a?.steps).toBe(steps)
        }),
        { numRuns: 50 },
      )
    },
    60_000,
  )
})