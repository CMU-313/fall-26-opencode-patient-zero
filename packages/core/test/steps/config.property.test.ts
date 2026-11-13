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

fc.configureGlobal({ seed: 42 })

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

type JsoncStyle = { shape: "v1" | "v1-mode" | "v2"; schema: boolean; comment: boolean; trailingComma: boolean }

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

// A window of whole numbers [-below, 1 + above] around the valid/invalid boundary, plus the same
// numbers shifted by a fraction (2.5-style values). invalidSteps alone never reaches the boundary:
// its fc.integer({ max: 0 }) spans [-2^31, 0] and under seed 42 only draws huge negatives, and its
// doubles are tiny or huge, never a fraction between small whole numbers. The window always
// contains 0 and 1 whatever below/above are drawn, so an off-by-one bound (>= 0 instead of > 0)
// or a missing integer check is exercised in every run, not only when the seed happens to hit it.
const boundaryWindow = fc
  .record({
    below: fc.nat({ max: 5 }),
    above: fc.nat({ max: 5 }),
    hundredths: fc.integer({ min: 1, max: 99 }),
  })
  .map((window) => {
    const wholes = Array.from({ length: window.below + window.above + 2 }, (_, i) => i - window.below)
    return [...wholes, ...wholes.map((whole) => whole + window.hundredths / 100)]
  })

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

// How opencode.jsonc writes the limit. "v1" uses the documented `"agent": {...}` key and
// "v1-mode" the older `"mode": {...}` key; Config detects both as the V1 format and migrates.
// "v2" uses `"agents": {...}` directly. A `$schema` line (which editors add) sits next to the
// agent key in real files. Comments and trailing commas are legal JSONC, so we sometimes add them.
const jsoncStyle: fc.Arbitrary<JsoncStyle> = fc.record({
  shape: fc.constantFrom("v1" as const, "v1-mode" as const, "v2" as const),
  schema: fc.boolean(),
  comment: fc.boolean(),
  trailingComma: fc.boolean(),
})

// Other frontmatter a real agent file may or may not carry next to the limit. The description
// line is optional in practice, and a file can have more than one mistake at once.
const markdownExtras = fc.record({ description: fc.boolean(), invalidMode: fc.boolean() })
type MarkdownExtras = { description: boolean; invalidMode: boolean }

// stepsYaml undefined writes no limit at all (the file only configures other fields).
function markdownFile(
  stepsYaml: string | undefined,
  style: string,
  extras: MarkdownExtras = { description: true, invalidMode: false },
) {
  const limit =
    stepsYaml === undefined ? [] : [style === "legacy-max" ? `maxSteps: ${stepsYaml}` : `steps: ${stepsYaml}`]
  const front = [
    ...(extras.description ? ["description: Reads the chain files"] : []),
    // An invalid mode written before the limit, so an error report that stops at the first
    // problem would never get to steps.
    ...(extras.invalidMode ? ["mode: sometimes"] : []),
    ...limit,
    ...(style === "legacy-extra" ? ["temperature: 0.5"] : []),
  ]
  return `---\n${front.join("\n")}\n---\nRead the chain files in order.`
}

// steps undefined writes no limit at all (the jsonc only configures other fields of the agent).
function jsoncFile(steps: number | undefined, style: JsoncStyle, agent = "b") {
  const key = style.shape === "v1" ? "agent" : style.shape === "v1-mode" ? "mode" : "agents"
  const schema = style.schema ? `  "$schema": "https://opencode.ai/config.json",\n` : ""
  const comment = style.comment ? "      // step limit\n" : ""
  const comma = style.trailingComma ? "," : ""
  const limit = steps === undefined ? "" : `,\n${comment}      "steps": ${steps}`
  return `{\n${schema}  "${key}": {\n    "${agent}": {\n      "description": "Reads the chain files"${limit}${comma}\n    }${comma}\n  }${comma}\n}`
}

const decodeAgent = Schema.decodeUnknownSync(ConfigAgent.Info)

// Writes a generated JS value as the YAML scalar a user would type, keeping its type: NaN and
// the infinities use YAML's own spellings, and strings are JSON-quoted so "3" stays a string.
function toYamlScalar(value: unknown) {
  if (typeof value === "number" && Number.isNaN(value)) return ".nan"
  if (value === Number.POSITIVE_INFINITY) return ".inf"
  if (value === Number.NEGATIVE_INFINITY) return "-.inf"
  return JSON.stringify(value)
}

describe("agent steps config properties", () => {
  // R2: OpenCode rejects a steps value that is not a positive whole number and shows an
  // error naming the field, instead of loading the agent.
  // Kind: invariant. (Schema level: for every invalid value, decoding fails and the error names steps.)
  test("R2 (schema): every invalid steps value is rejected with an error naming steps", () => {
    console.log("[property] R2 (schema) ran")
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
      console.log("[property] R2 (markdown) ran")
      await fc.assert(
        fc.asyncProperty(invalidYamlSteps, markdownStyle, markdownExtras, async (stepsYaml, style, extras) => {
          const { agents, logs } = await loadAgents({
            bad: markdownFile(stepsYaml, style, extras),
            good: markdownFile("3", "native"),
          })
          expect(agents.bad).toBeUndefined()
          expect(agents.good?.steps).toBe(3)
          const field = style === "legacy-max" ? "maxSteps" : "steps"
          expect(logs.some((line) => line.includes("bad") && line.includes(field))).toBe(true)
        }),
        { numRuns: 40 },
      )
    },
    60_000,
  )

  // R2: OpenCode rejects a steps value that is not a positive whole number and shows an
  // error naming the field, instead of loading the agent.
  // Kind: invariant. Each run writes one agent .md file per value: one from the full invalidSteps
  // generator (negatives, fractions, NaN, +/-Infinity, arbitrary strings, null, booleans) and one
  // for every value in a boundaryWindow (whole numbers straddling 0/1 and the same numbers plus a
  // fraction), and loads them all through ConfigAgentPlugin. The oracle checks both sides of the
  // boundary: a whole number >= 1 loads with exactly that limit; every other value is not loaded
  // and a warning names that agent (quoted, so "w1" can't match "w10") and the steps field.
  test(
    "claude: R2 rejects non-positive-integer steps",
    async () => {
      console.log("[property] claude: R2 ran")
      await fc.assert(
        fc.asyncProperty(invalidSteps, boundaryWindow, async (steps, window) => {
          const values = Object.fromEntries([["bad", steps], ...window.map((value, i) => [`w${i}`, value])])
          const { agents, logs } = await loadAgents(
            Object.fromEntries(
              Object.entries(values).map(([name, value]) => [name, markdownFile(toYamlScalar(value), "native")]),
            ),
          )
          for (const [name, value] of Object.entries(values)) {
            if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
              expect(agents[name]?.steps).toBe(value)
              continue
            }
            expect(agents[name]).toBeUndefined()
            expect(logs.some((line) => line.includes(`"${name}"`) && line.includes("steps"))).toBe(true)
          }
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
      console.log("[property] R4 ran")
      await fc.assert(
        fc.asyncProperty(
          validSteps,
          markdownStyle,
          fc.boolean(),
          jsoncStyle,
          async (steps, md, description, jsonc) => {
            const { agents } = await loadAgents(
              { a: markdownFile(String(steps), md, { description, invalidMode: false }) },
              jsoncFile(steps, jsonc),
            )
            // Equal to each other (the requirement) and equal to N, so "both undefined"
            // (both silently dropped) can't pass by accident.
            expect(agents.a?.steps).toBe(agents.b?.steps)
            expect(agents.a?.steps).toBe(steps)
          },
        ),
        { numRuns: 50 },
      )
    },
    60_000,
  )

  // R4 (one source sets it): the limit is the same whichever source sets it, even when the
  // other source also configures the same agent without a limit. Configuring an agent's other
  // fields in a second place must not erase (or invent) its step limit.
  // Kind: metamorphic. Swapping which source carries `steps` leaves agent.steps at N.
  test(
    "R4 (one source sets it): a limit set in one source survives the other source configuring the same agent",
    async () => {
      console.log("[property] R4 (one source) ran")
      await fc.assert(
        fc.asyncProperty(
          validSteps,
          fc.constantFrom("markdown", "jsonc"),
          markdownStyle,
          jsoncStyle,
          async (steps, source, md, jsonc) => {
            const { agents } = await loadAgents(
              { a: markdownFile(source === "markdown" ? String(steps) : undefined, md) },
              jsoncFile(source === "jsonc" ? steps : undefined, jsonc, "a"),
            )
            expect(agents.a?.steps).toBe(steps)
          },
        ),
        { numRuns: 50 },
      )
    },
    60_000,
  )
})