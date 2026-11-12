// Property tests for the agent step-limit RUNNER requirements (R3, R5).

// The harness below is a trimmed copy of the one in test/session-runner.test.ts: a fake LLM
// client that records every request and replays scripted responses, an "echo" tool that records
// every execution, and the same service layers. Each generated case builds a FRESH layer
// (new in-memory session state), exactly like each it.effect(...) in the original file does.
import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { LLMClient, LLMEvent, Model, type LLMClientShape, type LLMRequest } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { Database } from "@opencode-ai/core/database/database"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2 } from "@opencode-ai/core/event"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { Project } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { QuestionV2 } from "@opencode-ai/core/question"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunner } from "@opencode-ai/core/session/runner"
import * as SessionRunnerLLM from "@opencode-ai/core/session/runner/llm"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { ApplicationTools } from "@opencode-ai/core/tool/application-tools"
import { AgentV2 } from "@opencode-ai/core/agent"
import { Config } from "@opencode-ai/core/config"
import { ConfigCompaction } from "@opencode-ai/core/config/compaction"
import { Tool } from "@opencode-ai/core/tool/tool"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionStore } from "@opencode-ai/core/session/store"
import { SystemContext } from "@opencode-ai/core/system-context"
import { SystemContextRegistry } from "@opencode-ai/core/system-context/registry"
import { SkillGuidance } from "@opencode-ai/core/skill/guidance"
import { ReferenceGuidance } from "@opencode-ai/core/reference/guidance"
import { Location } from "@opencode-ai/core/location"
import { Effect, Layer, Schema, Stream } from "effect"

fc.configureGlobal({ seed: 42 })

// ---------- Harness (trimmed copy of test/session-runner.test.ts) ----------

const requests: LLMRequest[] = []
const executions: string[] = []
let responses: LLMEvent[][] = []
// A second user message admitted while the fake model streams request number `at` (1-based),
// modelling a user who types again mid-run. Set per case by runAgent.
let midRunInput: { at: number; admit: Effect.Effect<void> } | undefined

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      const events = Stream.fromIterable(responses.shift() ?? [])
      if (midRunInput?.at !== requests.length) return events
      return Stream.fromEffect(midRunInput.admit).pipe(Stream.flatMap(() => events))
    }) as unknown as LLMClientShape["stream"],
    generate: () => Effect.die("unused"),
  }),
)
const model = Model.make({ id: "fake-model", provider: "fake", route: OpenAIChat.route })
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: () => Effect.die("unused"),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const echo = Layer.effectDiscard(
  ToolRegistry.Service.use((registry) =>
    registry.register({
      echo: Tool.make({
        description: "Echo text",
        input: Schema.Struct({ text: Schema.String }),
        output: Schema.Struct({ text: Schema.String }),
        toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
        execute: ({ text }) =>
          Effect.sync(() => {
            executions.push(text)
            return { text }
          }),
      }),
    }),
  ),
)
const echoNode = makeLocationNode({ name: "test/steps-runner-tools", layer: echo, deps: [ToolRegistry.node] })
const models = SessionRunnerModel.layerWith(() => Effect.succeed(model))
const systemContextKey = SystemContext.Key.make("test/context")
const systemContext = Layer.effectDiscard(
  SystemContextRegistry.Service.pipe(
    Effect.flatMap((registry) =>
      registry.register({
        key: systemContextKey,
        load: Effect.sync(() =>
          SystemContext.combine([
            SystemContext.make({
              key: systemContextKey,
              codec: Schema.toCodecJson(Schema.String),
              load: Effect.succeed("Initial context"),
              baseline: String,
              update: (_previous, current) => current,
              removed: () => "System context source removed: test/context",
            }),
          ]),
        ),
      }),
    ),
  ),
).pipe(Layer.provideMerge(AppNodeBuilder.build(SystemContextRegistry.node)))
const skillGuidance = Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const referenceGuidance = Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) })
const config = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed([
        new Config.Document({
          type: "document",
          info: new Config.Info({
            compaction: new ConfigCompaction.Info({
              buffer: 3_000,
              keep: new ConfigCompaction.Keep({ tokens: 1_000 }),
            }),
          }),
        }),
      ]),
  }),
)
const runnerLayer = AppNodeBuilder.build(SessionRunnerLLM.node, [
  [Snapshot.node, Snapshot.noopLayer],
  [LayerNodePlatform.llmClient, client],
  [SessionRunnerModel.node, models],
  [SystemContextRegistry.node, systemContext],
  [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
  [SkillGuidance.node, skillGuidance],
  [ReferenceGuidance.node, referenceGuidance],
  [PermissionV2.node, permission],
  [Config.node, config],
])
const execution = Layer.effect(
  SessionExecution.Service,
  Effect.gen(function* () {
    const sessionRunner = yield* SessionRunner.Service
    const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
      drain: (sessionID, force) => sessionRunner.run({ sessionID, force }),
    })
    return SessionExecution.Service.of({
      active: coordinator.active,
      resume: coordinator.run,
      wake: coordinator.wake,
      interrupt: coordinator.interrupt,
    })
  }),
).pipe(Layer.provide(runnerLayer))
const layer = AppNodeBuilder.build(
  LayerNode.group([
    Database.node,
    EventV2.node,
    QuestionV2.node,
    SessionProjector.node,
    SessionStore.node,
    ApplicationTools.node,
    AgentV2.node,
    ToolRegistry.node,
    ToolRegistry.toolsNode,
    echoNode,
    SessionRunnerModel.node,
    SystemContextRegistry.node,
    SkillGuidance.node,
    ReferenceGuidance.node,
    Config.node,
    Snapshot.node,
    SessionRunnerLLM.node,
    SessionExecution.node,
    SessionV2.node,
  ]),
  [
    [LayerNodePlatform.llmClient, client],
    [PermissionV2.node, permission],
    [SessionRunnerModel.node, models],
    [SystemContextRegistry.node, systemContext],
    [Location.node, Location.boundNode({ directory: AbsolutePath.make("/project") })],
    [SkillGuidance.node, skillGuidance],
    [ReferenceGuidance.node, referenceGuidance],
    [Snapshot.node, Snapshot.noopLayer],
    [SessionExecution.node, execution],
    [Config.node, config],
  ],
)
const sessionID = SessionV2.ID.make("ses_steps_property")

// ---------- Scripted model behaviour ----------

// What the fake model does on one step: call `calls` echo tools, or reply with text only.
type ModelStep = { kind: "tool"; calls: number } | { kind: "text" }

const toolStep = (step: number, calls: number): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  ...Array.from({ length: calls }, (_, i) =>
    LLMEvent.toolCall({ id: `call-${step}-${i}`, name: "echo", input: { text: `step${step}-call${i}` } }),
  ),
  LLMEvent.stepFinish({ index: 0, reason: "tool-calls" }),
  LLMEvent.finish({ reason: "tool-calls" }),
]
const textStep = (step: number): LLMEvent[] => [
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: `text-${step}` }),
  LLMEvent.textDelta({ id: `text-${step}`, text: "Done." }),
  LLMEvent.textEnd({ id: `text-${step}` }),
  LLMEvent.stepFinish({ index: 0, reason: "stop" }),
  LLMEvent.finish({ reason: "stop" }),
]

type Delivery = "steer" | "queue"
type RunOptions = {
  // Agent the session is bound to. A name that was never loaded models an agent whose file was
  // rejected (R2): the runner sees no agent info at all.
  agent?: string
  // How the first prompt is delivered.
  first?: Delivery
  // A second prompt the user sends while request number `at` is streaming.
  second?: { at: number; delivery: Delivery }
}

// Runs one prompt on a fresh session with the given step limit (undefined = no limit) and
// model script. Returns every request the runner sent, every tool that actually executed, and
// every tool failure recorded in the session history.
const runAgent = (steps: number | undefined, script: readonly ModelStep[], options: RunOptions = {}) =>
  Effect.gen(function* () {
    requests.length = 0
    executions.length = 0
    responses = script.map((step, i) => (step.kind === "tool" ? toolStep(i + 1, step.calls) : textStep(i + 1)))

    const { db } = yield* Database.Service
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        slug: sessionID,
        directory: "/project",
        title: "test",
        version: "test",
        ...(options.agent === undefined ? {} : { agent: options.agent }),
      })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)

    const agents = yield* AgentV2.Service
    yield* agents.transform((editor) =>
      editor.update(AgentV2.ID.make("build"), (agent) => {
        if (steps !== undefined) agent.steps = steps
      }),
    )
    const session = yield* SessionV2.Service
    const second = options.second
    midRunInput =
      second === undefined
        ? undefined
        : {
            at: second.at,
            admit: session
              .prompt({
                sessionID,
                prompt: Prompt.make({ text: "Also check the README" }),
                delivery: second.delivery,
                resume: false,
              })
              .pipe(Effect.asVoid, Effect.orDie),
          }
    yield* session.prompt({
      sessionID,
      prompt: Prompt.make({ text: "Read the chain files" }),
      delivery: options.first,
      resume: false,
    })
    yield* session.resume(sessionID)
    const history = yield* session.history({ sessionID, limit: 10_000 })
    const toolFailures = history.events.flatMap((event) =>
      event.type === "session.next.tool.failed" ? [{ callID: event.data.callID, message: event.data.error.message }] : [],
    )
    return { requests: [...requests], executions: [...executions], toolFailures }
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.runPromise)

const systemText = (request: LLMRequest | undefined) => (request?.system ?? []).map((part) => part.text).join("\n")
const lastMessageText = (request: LLMRequest | undefined) =>
  JSON.stringify(request?.messages.at(-1)?.content ?? [])

// ---------- Generators ----------

// Step limit N. 1..6 keeps runs fast and always includes the boundaries: N = 1 (the very first
// request is already the final one, so it must have no tools) and N = 2 (one tool step, then stop).
const stepLimit = fc.integer({ min: 1, max: 6 })

// One model step. Weighted 3:1 toward tool calls so most scripts reach the limit (the case
// interviewees cared about, S-15 / C-9), while some stop early on their own. 1-3 calls per step
// checks that parallel tool calls in one step still count as ONE step.
const modelStep: fc.Arbitrary<ModelStep> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 1, max: 3 }).map((calls) => ({ kind: "tool" as const, calls })) },
  { weight: 1, arbitrary: fc.constant({ kind: "text" as const }) },
)

// A script always longer than the largest N, so the fake model never "runs out" of responses.
// Tool steps at or past N model a model that ignores the max-steps instruction and tries to
// call a tool anyway, which is exactly what R3 says must not execute.
const script = fc.array(modelStep, { minLength: 8, maxLength: 8 })

// The phrase the R5 plan instruction must contain (see src/session/runner/max-steps.ts).
const PLAN_PHRASE = "numbered plan"

const delivery = fc.constantFrom<Delivery>("steer", "queue")

// Oracle for R3 (budget): the expected sequence of provider turns when a second message arrives
// during turn `second.at`. For each turn: is it the final allowed step, and how many tool calls run.
//  - The budget counter starts at 1 and the turn whose counter reaches N is final (no tools run).
//  - A run continues after a turn only if tools ran, or a steered message is waiting.
//  - A waiting steered message is picked up at the start of the next turn: counter back to 1.
//  - A queued message waits until the run would stop, then starts a new run at counter 1.
function expectedTurns(n: number, steps: readonly ModelStep[], second: { at: number; delivery: Delivery }) {
  const turns: { final: boolean; calls: number }[] = []
  const pending = { steer: false, queue: false }
  const state = { counter: 1, more: true }
  while (state.more) {
    while (state.more) {
      const final = state.counter >= n
      const step = steps[turns.length]
      const calls = step?.kind === "tool" && !final ? step.calls : 0
      turns.push({ final, calls })
      if (turns.length === second.at) pending[second.delivery] = true
      state.more = calls > 0 || pending.steer
      state.counter = pending.steer ? 1 : state.counter + 1
      pending.steer = false
    }
    state.more = pending.queue
    state.counter = 1
    pending.queue = false
  }
  return turns
}

describe("agent steps runner properties", () => {
  // R3 (revised in P4): On the final allowed step, the model request offers no tools
  // (toolChoice none) and includes the max-steps instruction requiring a summary of work done
  // and work remaining; any tool call attempted on that step is not executed.
  // Kind: model / oracle. A tiny model of the step loop predicts how many requests are sent,
  // which one is the final step, and which tool calls run. The real runner must agree.
  test(
    "R3: the final allowed step has no tools, carries the max-steps prompt, and runs no tools",
    async () => {
      console.log("[property] R3 ran")
      await fc.assert(
        fc.asyncProperty(stepLimit, script, async (n, steps) => {
          const result = await runAgent(n, steps)

          // ---- Oracle: the obviously-correct model of the loop ----
          // The run stops at the first text-only step, or at step N, whichever comes first.
          const firstText = steps.findIndex((s) => s.kind === "text") + 1 // 0 = never
          const expectedRequests = firstText === 0 ? n : Math.min(firstText, n)
          // Tools only run on tool steps BEFORE step N.
          const expectedExecutions = steps
            .slice(0, Math.min(expectedRequests, n - 1))
            .flatMap((s, i) =>
              s.kind === "tool" ? Array.from({ length: s.calls }, (_, c) => `step${i + 1}-call${c}`) : [],
            )

          // ---- Compare the runner against the oracle ----
          expect(result.requests).toHaveLength(expectedRequests)
          result.requests.forEach((request, i) => {
            const isFinal = i + 1 === n
            if (isFinal) {
              expect(request.toolChoice).toMatchObject({ type: "none" })
              expect(request.tools).toEqual([])
              expect(lastMessageText(request)).toContain("MAXIMUM STEPS REACHED")
            } else {
              expect(request.toolChoice).toBeUndefined()
              expect(request.tools.length).toBeGreaterThan(0)
              expect(lastMessageText(request)).not.toContain("MAXIMUM STEPS REACHED")
            }
          })
          expect([...result.executions].sort()).toEqual([...expectedExecutions].sort())
          // A tool call the model attempts anyway on step N is not run, and the session records
          // why (S-15: the user needs to see why it stopped).
          const finalStep = expectedRequests === n ? steps[n - 1] : undefined
          const blockedCalls =
            finalStep?.kind === "tool" ? Array.from({ length: finalStep.calls }, (_, c) => `call-${n}-${c}`) : []
          blockedCalls.forEach((callID) => {
            const failure = result.toolFailures.find((f) => f.callID === callID)
            expect(failure?.message).toMatch(/maximum.*steps/i)
          })
        }),
        { numRuns: 30 },
      )
    },
    120_000,
  )

  // R3 (step budget per user message): the limit N counts provider turns since the latest user
  // message. A message sent mid-run (steered in at the next turn, or queued until the run would
  // otherwise stop) starts a fresh budget of N, however the first message was delivered.
  // Kind: model / oracle. The same tiny loop model as R3, extended with one extra message.
  test(
    "R3 (budget): a new user message mid-run restarts the step budget",
    async () => {
      console.log("[property] R3 (budget) ran")
      await fc.assert(
        fc.asyncProperty(
          stepLimit.chain((n) =>
            fc.record({
              n: fc.constant(n),
              steps: fc.array(modelStep, { minLength: 2 * n, maxLength: 2 * n }),
              first: delivery,
              second: fc.record({ at: fc.integer({ min: 1, max: n }), delivery }),
            }),
          ),
          async (input) => {
            const result = await runAgent(input.n, input.steps, { first: input.first, second: input.second })
            const expected = expectedTurns(input.n, input.steps, input.second)

            expect(result.requests).toHaveLength(expected.length)
            result.requests.forEach((request, i) => {
              if (expected[i]?.final) {
                expect(request.toolChoice).toMatchObject({ type: "none" })
                expect(request.tools).toEqual([])
                expect(lastMessageText(request)).toContain("MAXIMUM STEPS REACHED")
              } else {
                expect(request.toolChoice).toBeUndefined()
                expect(request.tools.length).toBeGreaterThan(0)
                expect(lastMessageText(request)).not.toContain("MAXIMUM STEPS REACHED")
              }
            })
            const expectedExecutions = expected.flatMap((turn, i) =>
              Array.from({ length: turn.calls }, (_, c) => `step${i + 1}-call${c}`),
            )
            expect([...result.executions].sort()).toEqual([...expectedExecutions].sort())
          },
        ),
        { numRuns: 30 },
      )
    },
    120_000,
  )

  // R2 (runner side): an agent whose file was rejected "can't be selected and doesn't run with
  // any limit". A session bound to an agent that never loaded must run as if unlimited: no plan
  // instruction, tools on every request, no max-steps prompt, stopping only when the model does.
  // Kind: model / oracle (the unlimited loop).
  test(
    "R2 (runner): a session whose agent was not loaded runs with no step limit",
    async () => {
      console.log("[property] R2 (runner) ran")
      await fc.assert(
        fc.asyncProperty(script, async (steps) => {
          const result = await runAgent(undefined, steps, { agent: "rejected-agent" })
          // With no limit the run stops at the first text-only reply, or after the script runs
          // out (the fake model then returns an empty reply).
          const firstText = steps.findIndex((s) => s.kind === "text") + 1
          expect(result.requests).toHaveLength(firstText === 0 ? steps.length + 1 : firstText)
          result.requests.forEach((request) => {
            expect(request.toolChoice).toBeUndefined()
            expect(request.tools.length).toBeGreaterThan(0)
            expect(lastMessageText(request)).not.toContain("MAXIMUM STEPS REACHED")
            expect(systemText(request)).not.toContain(PLAN_PHRASE)
          })
        }),
        { numRuns: 15 },
      )
    },
    120_000,
  )

  // R5 (revised in P4): When an agent has a step limit, its first model request tells the
  // model the limit and instructs it to post a short numbered plan before using tools,
  // without waiting for approval.
  // Kind: metamorphic. Running the SAME task with and without a step limit: adding the limit
  // must add the plan instruction (naming N) to the first request's system prompt and change
  // nothing else in it; without a limit, no plan instruction appears.
  test(
    "R5: adding a step limit adds exactly the plan instruction to the first request",
    async () => {
      console.log("[property] R5 ran")
      await fc.assert(
        fc.asyncProperty(stepLimit, script, async (n, steps) => {
          const limited = await runAgent(n, steps)
          const unlimited = await runAgent(undefined, steps)
          const withLimit = systemText(limited.requests[0])
          const withoutLimit = systemText(unlimited.requests[0])

          expect(withoutLimit).not.toContain(PLAN_PHRASE)
          expect(withLimit).toContain(PLAN_PHRASE)
          expect(withLimit).toContain(String(n))
          // The only difference is the added plan part.
          const added = (limited.requests[0]?.system ?? [])
            .map((part) => part.text)
            .filter((text) => !(unlimited.requests[0]?.system ?? []).some((part) => part.text === text))
          expect(added).toHaveLength(1)
          expect(added[0]).toContain(PLAN_PHRASE)
        }),
        { numRuns: 15 },
      )
    },
    120_000,
  )
})