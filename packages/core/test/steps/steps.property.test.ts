import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { Schema } from "effect"
import { ConfigAgent } from "@opencode-ai/core/config/agent"

const decodeAgent = Schema.decodeUnknownSync(ConfigAgent.Info)

// Generators: interviewees tried -2 (C-7, O-1); P3 acceptance criteria named 0, 2.5 and "five".
// Each family is covered, plus JS traps a hand-written test would miss (NaN, ±Infinity, numeric strings).
const invalidSteps = fc.oneof(
  fc.integer({ max: 0 }),                                                  // 0 and negatives
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)), // 2.5…
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.string(),                                                             // "five", "3"
  fc.constantFrom(null, true, false),
)

describe("agent steps properties", () => {
  // R2: OpenCode rejects a steps value that is not a positive whole number and
  // shows an error naming the field, instead of loading the agent.
  // Kind: invariant
  test("R2: every invalid steps value is rejected with an error naming steps", () => {
    fc.assert(
      fc.property(invalidSteps, (steps) => {
        let message: string | undefined
        try { decodeAgent({ steps }) } catch (e) { message = String(e) }
        expect(message).toBeDefined()
        expect(message).toContain("steps")
      }),
    )
  })
})