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

// ---------- Harness (trimmed copy of test/session-runner.test.ts) ----------

const requests: LLMRequest[] = []
const executions: string[] = []
let responses: LLMEvent[][] = []

const client = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: ((request: LLMRequest) => {
      requests.push(request)
      return Stream.fromIterable(responses.shift() ?? [])
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

// Runs one prompt on a fresh session with the given step limit (undefined = no limit) and
// model script. Returns every request the runner sent and every tool that actually executed.
const runAgent = (steps: number | undefined, script: readonly ModelStep[]) =>
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
    yield* session.prompt({ sessionID, prompt: Prompt.make({ text: "Read the chain files" }), resume: false })
    yield* session.resume(sessionID)
    return { requests: [...requests], executions: [...executions] }
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
        }),
        { numRuns: 30 },
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