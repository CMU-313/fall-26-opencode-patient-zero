# Traceability: Cynthia (ccao2)

**Target feature:** Agent steps feature

- `packages/core/src/session/runner/llm.ts`
- `packages/core/src/session/runner/max-steps.ts`
- `packages/core/src/config/plugin/agent.ts`

## Requirements

| ID  | Interview evidence                                                                                                                                                                        | Requirement                                                                                                                                                                                                                         | Acceptance Criteria                                                                                                                                                        | Changed in P4?          | Property (kind)                                                                                                                                                                                                                                             | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Mutants it kills                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | O-6: “Is there no counter?”; O-10; O-12: “some kind of visual counter… to see its progress”                                                                                               | While an agent with a step limit is running, the UI shows the current step and the limit.                                                                                                                                           | With steps: 5, the session view shows “Step 1 of 5” during the first model call, counts up with each step, and shows “Step 5 of 5” on the final text-only step.            | No / not doing this one | not doing this one                                                                                                                                                                                                                                          | <br>                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | — (no property)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R2  | C-7, C-8, O-1 <br> <br>“I would expect it to immediately let me know that the step count is invalid.” <br> <br>“...the message Gemini gives when it tells you it can’t complete the task” | OpenCode rejects a steps value that is not a positive whole number and shows an error naming the field, instead of loading the agent.                                                                                               | An agent file with steps: -2 (also tested with 0, 2.5 and "five") produces a config error that mentions steps. The agent can’t be selected and doesn’t run with any limit. | No                      | Invariant, because invalid steps values should always be rejected                                                                                                                                                                                           | packages/core/test/steps/config.property.test.ts<br><br>test("R2 (schema): every invalid steps value is rejected with an error naming steps")<br><br>test("R2 (markdown): an agent file with invalid steps is not loaded and an error naming steps is reported")<br><br>test("claude: R2 rejects non-positive-integer steps")<br><br>packages/core/test/steps/runner.property.test.ts<br><br>test("R2 (runner): a session whose agent was not loaded runs with no step limit") | Hand-written: H4<br>Stryker (125): #0, #2–5, #7, #10–14, #19–27, #30, #32, #37–40, #48, #53, #55, #59, #67, #69, #91–93, #95, #98–101, #104–107, #110–112, #114, #117, #119, #121–132, #135–136, #138–142, #144, #146–147, #149–150, #152, #154–155, #157–159, #171–173, #175–178, #182, #188, #191, #193–194, #196–197, #199, #201–203, #209–210, #214–221, #225, #227–228, #231, #233–234, #239, #242–244, #246–250, #253–254 |
| R3  | C-9: “the summary should be about what it just did”; S-15: needs to see why it stopped                                                                                                    | On the final allowed step, the model request offers no tools (`toolChoice: none`) and includes the max-steps instruction requiring a summary of work done and work remaining; any tool call attempted on that step is not executed. | Given a valid steps value, the last step ran has no tool calls (if the model tries and runs one, it does not run) and the max-step instruction is given.                   | Yes                     | Oracle, a simple model predicts what the runner should send                                                                                                                                                                                                 | packages/core/test/steps/runner.property.test.ts<br><br>test("R3: the final allowed step has no tools, carries the max-steps prompt, and runs no tools")<br><br>test("R3 (budget): a new user message mid-run restarts the step budget")                                                                                                                                                                                                                                       | Hand-written: H1, H2<br>Stryker (73): #154–155, #157–164, #167–175, #177, #179–181, #188, #191, #199, #201–203, #207–225, #227–228, #230–231, #233–234, #239–240, #242–244, #246–259                                                                                                                                                                                                                                            |
| R4  | C-11: “no change in behavior”; S-10: “they should behave the same”; O-5: “they should do the same thing”                                                                                  | A steps value set in an agent Markdown file and the same value set in opencode.jsonc produce the same limit.                                                                                                                        | Agent A (steps: 3 in .opencode/agents/a.md) and agent B ("steps": 3 in opencode.jsonc), each with the same prompt and permissions, both stop after reading 2 chain files.  | No                      | Metamorphic, moving steps: N from a Markdown file to opencode.jsonc shouldn’t change the resulting agent.steps                                                                                                                                              | packages/core/test/steps/config.property.test.ts<br><br>test("R4: the same steps value in Markdown and in opencode.jsonc gives the same limit")<br><br>test("R4 (one source sets it): a limit set in one source survives the other source configuring the same agent")                                                                                                                                                                                                         | Hand-written: H5<br>Stryker (85): #0, #2–14, #19, #21, #23–27, #30, #32, #37–40, #48, #53, #55, #59, #67, #69, #90–93, #95, #98–101, #104–107, #110–112, #114, #117, #119, #121–127, #131–132, #135–136, #138–140, #262–263, #269–270, #272, #274–282, #284–286, #288, #298                                                                                                                                                     |
| R5  | C-13: “divide up the steps of the task before it starts and… say how it divided up the task                                                                                               | When an agent has a step limit, its first model request tells the model the limit and instructs it to post a short numbered plan before using tools, without waiting for approval.                                                  | For any step limit N, the first request’s system prompt contains the plan instruction naming N. Without a limit, it doesn’t. Nothing else in the system prompt changes.    | Yes                     | Metamorphic, if steps exists and is valid value, `requests[0].system` contains the plan instruction. For an agent _with no_ `steps`, it doesn’t, and nothing else in the system prompt changes. Adding or removing the limit toggles exactly that one part. | packages/core/test/steps/runner.property.test.ts<br><br>test("R5: adding a step limit adds exactly the plan instruction to the first request")                                                                                                                                                                                                                                                                                                                                 | Hand-written: H3<br>Stryker (41): #154–155, #157–159, #171–172, #188, #191–192, #194–196, #198–203, #206, #209, #211–212, #215–218, #227, #231, #233–234, #242–244, #246–250, #260–261                                                                                                                                                                                                                                          |

Properties written or suggested by opencode or another AI tool: R2, R3, R4, R5 (Claude)

## Requirement changes

|ID|Original requirement (P3)|Revised requirement|Why it changed|
|---|---|---|---|
|R3|On the final allowed step, the agent gets no tools and must reply in text: it says the limit was reached, what it did, and what is left. <br><br>|On the final allowed step, the model request offers no tools (`toolChoice: none`) and includes the max-steps instruction requiring a summary of work done and work remaining; any tool call attempted on that step is not executed.|Not checkable. The non-deterministic nature of the LLM output makes it not checkable what the LLM is going to say. Changed to making sure that the model is not making any tool calls. And that it appends some sort of work summary at the end.<br><br>The user need (C-9, S-15: know why it stopped and what’s left) is kept by guaranteeing the final request disables tools and includes the instruction to summarize work done and remaining.|
|R5|Before its first tool call, an agent with a step limit posts a short plan of the work and then starts without waiting for approval.|When an agent has a step limit, its first model request tells the model the limit and instructs it to post a short numbered plan before using tools, without waiting for approval.|Not feasible. There's no way to make sure the model WILL post a plan because of the non-deterministic nature of an LLM. Changed to make sure that the model will always receive a prompt telling it to post a plan (but not checking if the plan is actually being returned by the model).<br><br>The user need (C-13: see how the work was divided; C-14: don’t wait for approval) is kept by guaranteeing every step-limited agent is told the limit and instructed to plan first.|

## Step 3: Triage

|Property|Counterexample|Outcome|Fix|
|---|---|---|---|
|R2 (markdown)|`["2.5", "native"]`|Code bug|The invalid agent was dropped silently with no message. `decode()` in `config/plugin/agent.ts` now logs a warning naming the agent and the invalid field.|
|R2 (markdown)|`["2.5", "legacy-max"]`|Wrong test|After the fix, the warning named `maxSteps` (the key used in legacy files), but the property only looked for `steps`. The property now expects the field name used in the file.|
|R5|(any N)|Code bug|No plan instruction existed. Added `stepPlanPrompt` in `max-steps.ts` and included it in the system prompt in `llm.ts` when the agent has a step limit.|

## Hand-written mutants

|ID|Requirement targeted|Change|Predicted killer|Actual result|After strengthening|
|---|---|---|---|---|---|
|H1|R3|`llm.ts:202`: the final-step check `currentStep >= agent.info.steps` becomes `currentStep > agent.info.steps`, so the text-only "max steps" step comes one step too late (step N+1).|**R3** (`runner.property.test.ts`). On request N, the oracle's `isFinal` branch expects `toolChoice: none`, `tools: []` and the MAXIMUM STEPS prompt, but the mutant still sends tools. When the script keeps calling tools, there are also N+1 requests instead of N, and the tool calls on step N run. N = 1 always reaches the final step, so some run will hit it.|**Killed** by **R3** (1st run). Counterexample `N = 1`, model calls a tool every step: expected 1 request, got 2, because the step after the limit still had tools.|**Killed** by **R3** and **R3 (budget)**. Same as Stryker #180.|
|H2|R3|`llm.ts:203`: tools are loaded on every step. The final step still sends `toolChoice: "none"`, but it is now the only guard.|**R3**. On the final request, `expect(request.tools).toEqual([])` fails because the tool list is not empty. If the scripted model calls a tool on step N anyway, the call runs, so the `executions` check fails too. That second check is the "any tool call attempted is not executed" part of R3.|**Killed** by **R3** (1st run). Counterexample `N = 1`: expected 1 request, got 3. The tool call on the final step ran and the loop kept going.|**Killed** by **R3** and **R3 (budget)**.|
|H3|R5|`max-steps.ts:21`: the plan instruction gives the limit as `${steps - 1}` instead of `${steps}`.|**R5**, but only by luck. The only check on the number is `withLimit.toContain(String(n))` over the whole system prompt. That prompt also includes `Today's date: …`, so a single digit can match the date even when the limit is wrong (e.g. on "Thu Nov 12 2026", N = 1, 2 and 6 still pass). The mutant only dies on runs where N is a digit that isn't in the date, like N = 3, 4 or 5 today. With 15 runs over N in 1..6, that very likely happens, but whether it gets killed depends on the date. A check like `toContain(\`limit of ${n} steps`)` would kill it every time.|**Killed** by **R5** (1st run). Counterexample `N = 1`: the plan text said "limit of 0 steps", so `toContain("1")` failed. The date risk did not show up. In this harness the checked system text is just the plan part plus `Initial context`, with no date, so every N in 1..6 kills it.|**Killed** by **R5**.|
|H4|R2|`config/plugin/agent.ts:197`: `invalidReason` returns `"invalid agent configuration"` instead of the schema's error text. The agent is still skipped, but the warning no longer names the bad field.|**R2 (markdown)**. The log line still contains `bad`, but not `steps` or `maxSteps`, so `logs.some(line => line.includes("bad") && line.includes(field))` fails on the first case. **R2 (schema)** misses it because it calls the schema decoder directly and never goes through this function.|**Killed** by **R2 (markdown)** (1st run). Counterexample `[".nan", "native"]`: the warning no longer named `steps`. R2 (schema) passed, as predicted.|**Killed** by **R2 (markdown)**.|
|H5|R4|`v1/config/migrate.ts:121`: `steps: info.steps` is removed from `migrateAgent`. Agent files in the old format (any extra key, or `maxSteps`) lose their step limit, while `opencode.jsonc` still works.|**R4**. When the Markdown style is `legacy-extra` or `legacy-max` (2 of 3 styles), `agents.a.steps` is `undefined` while `agents.b.steps` is N. Both the `a == b` check and the `a == N` check fail. **R2 (markdown)** misses it: the invalid legacy agent still fails to decode, and the valid control agent `good` uses the `native` style.|**Killed** by **R4** (1st run). Counterexample `[1, "native", {shape: "v1"}]`. The predicted path was a legacy Markdown file losing its limit. The actual path was the other side: a V1-shaped `opencode.jsonc` also goes through `migrateAgent`, so agent `b` lost `steps` (`a` = 1, `b` = undefined).|**Killed** by **R4** and the new **R4 (one source)**: counterexample `[1, "markdown", "legacy-max", {shape: "v1"}]`. The limit is only in a `maxSteps` Markdown file, which goes through `migrateAgent`, so agent `a` ends up with no limit.|

## Stryker comparison

**Setup:** fast-check seed `42` (`fc.configureGlobal({ seed: 42 })` in both property files). Config: `packages/core/stryker.ccao2.config.json`, command runner `bun test test/steps/runner.property.test.ts test/steps/config.property.test.ts`, `coverageAnalysis: "off"`, `inPlace: true`. Report: `mutants/ccao2/mutation.html`.

**Mutate ranges:** `llm.ts:186-218, 245-252, 387-410`; `max-steps.ts:1-21`; `config/plugin/agent.ts:46-125, 148-200`; `v1/config/migrate.ts:30-33, 97-125`.

**Raw mutation score: 53.74%** (294 mutants: 151 killed, 7 timeout, 136 survived, 0 no-coverage, 0 errors). No-coverage is 0 only because `coverageAnalysis` is `"off"`.

|File|Score|Killed|Timeout|Survived|
|---|---|---|---|---|
|max-steps.ts|100.00%|3|0|0|
|llm.ts|61.32%|58|7|41|
|config/plugin/agent.ts|49.66%|73|0|74|
|v1/config/migrate.ts|44.74%|17|0|21|

### Q1: Hand-written mutants vs. Stryker's generated mutants

|ID|Closest Stryker mutant at that site|Equivalent?|Mutator that would have been needed|
|---|---|---|---|
|H1|`llm.ts:202` EqualityOperator `currentStep >= agent.info.steps` → `currentStep > agent.info.steps` (Killed)|**Yes, exact match**|(already generated)|
|H2|None at `llm.ts:203` except OptionalChaining on `agent.info?.permissions` (Survived). Stryker generated no mutant of the ternary test `isLastStep ? …` at 203 (nor at 215 or 217). The broader `llm.ts:202` ConditionalExpression `… && …` → `false` (Killed) also disables the final step, but it changes `toolChoice` and the prompt too, not only the tool list.|**No**|ConditionalExpression on the ternary test: `isLastStep ? undefined : …` → `false ? undefined : …`|
|H3|`max-steps.ts:21` StringLiteral: the whole template → `` ` ` `` (Killed)|**No**|An arithmetic-insertion / off-by-one mutator (`${steps}` → `${steps - 1}`). Stryker's ArithmeticOperator only swaps existing operators; it doesn't insert new ones.|
|H4|`agent.ts:197` BlockStatement: catch block → `{}` (Killed). `invalidReason` then returns `undefined`, so the warning loses the field name. Stryker generated no mutant on line 198 (`return String(error)`).|**Partial** (same observable effect, different mechanism)|A return-value replacement that swaps a non-literal expression (`String(error)`) for a constant string|
|H5|`migrate.ts:112` ObjectLiteral: the whole returned object → `{}` (Killed)|**No** (Stryker drops every field at once, not just `steps`)|A single-property-removal mutator (delete one key from an object literal)|

### Q2: Stryker survivors not similar to any hand-written mutant

19 of the 136 survivors are similar to a hand-written mutant:

- `agent.ts:194-196` (6) are like **H4**: they change what `invalidReason` reports.
- `migrate.ts:107-115` (10) are like **H5**: they drop or alter a field inside `migrateAgent` (temperature / top_p / request body).
- `agent.ts:115` (1) is like **H5** in outcome (the agent loses `steps`) but through a different mechanism.
- `llm.ts:202` `agent.info?.steps !== undefined` → `true` (1) is on the H1 line but is effectively equivalent: `currentStep >= undefined` is false.
- `llm.ts:202` OptionalChaining (1) is also on the H1 line.

The other **117** are listed below.

|Location|#|Mutation(s)|Plausible real-developer change?|
|---|---|---|---|
|`llm.ts:187-195` (promotion)|10|`if (promotion)` → `true`; `promotion === "queue"` flips/`""`/block removed; `promoted +=` → `-=`; `if (promoted > 0) currentStep = 1` → `if (false)`|`currentStep = 1` removed: **yes** (forgetting to reset the step budget on new user input; steps-related). `+=` → `-=`: unlikely. Others: equality flip yes, `""` literal no.|
|`llm.ts:203, 209, 210` (OptionalChaining)|3|`agent.info?.x` → `agent.info.x`|Yes (dropping `?.`); untested because `agent.info` is always defined in the harness|
|`llm.ts:204, 207` (prompt cache key)|7|Regex anchors / char class / quantifier changed; `.slice(4)` removed; `providerOptions` emptied|Regex anchor/quantifier edits: yes. Emptying `providerOptions`: yes (forgetting the option). Not step-related.|
|`llm.ts:213` (system-part filter)|2|`part.length > 0` → `true` / `>= 0`|`>= 0`: yes (boundary slip). No generated agent has an empty system part.|
|`llm.ts:249`|1|"Tools are disabled after the maximum agent steps" → `""`|Rewording the message: yes. Emptying it: no. R3 doesn't assert the message text.|
|`llm.ts:387`|1|`Effect.fn("SessionRunner.run")` → `Effect.fn("")`|No (tracing span name only; behaviorally equivalent)|
|`llm.ts:392-408` (run loop: steer/queue/force)|15|Boolean / logical / conditional flips on `hasSteer`, `hasQueue`, `input.force`, `shouldRun`, `needsContinuation`; `"steer"`/`"queue"` → `""`|`&&`/`\|` and negation flips: yes. String literals → `""`: no. Tests never use queue/steer delivery or `force`.|
|`agent.ts:47`|1|plugin `id: "config-agent"` → `""`|No|
|`agent.ts:61, 65, 67, 69, 157, 166, 187` (defensive guards)|8|`if (!content)`, `if (!markdown)`, `if (!info)` → `if (false)`; `result?.` → `result.`; catch handlers return `undefined` / `["Stryker was here"]`|Removing a null check or `?.`: yes. Catch handler returning `undefined`: plausible. Injected junk array: no.|
|`agent.ts:79-98, 116-117` (permissions, `default_agent`, `disabled`, `exists`)|19|Permission spreading removed/emptied; `default_agent` → `""` / skipped; `item.disabled` branch removed; `exists` forced true/false/flipped|`if (!exists)` flips and removing `draft.remove`: yes. Fixtures have no permissions, `default_agent` or `disabled`.|
|`agent.ts:99-114` (model, variant, request, system, description, mode, hidden, color)|30|`!== undefined` → `true`/`false`/`=== undefined`; `??` → `&&`; object emptied; `?.` dropped|`if (true)` ("always assign"), `??` → `&&` and `?.` removal: yes. Equality flips: less likely. The fixtures set `description` but never assert it; other fields are unset.|
|`agent.ts:151`|2|glob `dot: true` / `symlink: true` → `false`|Yes. The fixture paths have no dot directories or symlinks.|
|`agent.ts:169-172` (name normalization)|4|`.replaceAll("\\", "/")` → `""`; regex `^` / `$` anchors dropped; `.trim()` removed|Anchor drop and missing `.trim()`: yes. `"/"` → `""`: no.|
|`agent.ts:173`|1|`!agentKeys.has(key)` → `agentKeys.has(key)` (inverted legacy detection)|**Yes** (inverted predicate). It survives because the legacy decoder also accepts `steps`, so every fixture still decodes. Steps-related.|
|`agent.ts:184`|2|primary-mode object emptied / `mode: "primary"` → `""`|Emptying: no. Fixtures never use `modes/`.|
|`migrate.ts:31-32` (`isV1`)|8|Type/null/array guard flips; `.some` → `.every`|`.some` → `.every` and `\|` → `&&`: yes. Fixtures only pass plain objects with one top-level key.|
|`migrate.ts:100-103` (`agents()`)|3|`mode` entries mapped to `undefined`; empty check removed; junk array for null agents|Removing the empty check: yes. Fixtures have no V1 `mode` key.|

### Q3: What each approach found that the other didn't

**Only the hand-written mutants:**

- Semantic edits Stryker has no operator for: arithmetic insertion inside a template (H3), removing one object property (H5), replacing a computed return with a constant (H4), and dropping one guard inside a ternary while keeping the others (H2).
- Each one targets one requirement (R2–R5), and all 5 were killed.
- Writing them showed things about the oracles that Stryker didn't: H3's predicted date-coincidence risk turned out not to apply, and H5's actual kill path was the V1 `opencode.jsonc` side, not the Markdown side.

**Only Stryker:**

- **Steps-related gaps:**
    - `llm.ts:195` (step counter not reset on promoted input)
    - `agent.ts:115` (`steps` overwritten with `undefined` by a later document)
    - `agent.ts:173` (inverted legacy detection)
    - `llm.ts:249` (disabled-tools message text not asserted)
    - `agent.ts:194-196` (`invalidReason` decode options and fallback string)
- **Unexercised inputs:** steer/queue/force delivery, permissions, `default_agent`, `disabled`, `modes/`, other agent fields, V1 `mode`, temperature/top_p.
- **Defensive code:** null/undefined guards, optional chaining, catch handlers.
- **Unrelated code inside the ranges:** prompt cache key (`llm.ts:204-207`).
- **Equivalent or cosmetic mutants:** `llm.ts:202` `… !== undefined` → `true`, `llm.ts:387` span name.

**Both:** the final-step boundary (H1 = Stryker `llm.ts:202` `>=` → `>`, killed by R3 in both).

### Final results (after strengthening the properties)

Same seed (`42`), config and mutate ranges as above. Report: `mutants/ccao2/mutation.html` (replaces the first run's report).

||First run|After strengthening|
|---|---|---|
|Total mutants|294|294|
|Killed|151|172|
|Timeout|7|13|
|Survived|136|109|
|No coverage|0|0|
|**Score as Stryker reports it** ((killed + timeout) ÷ total)|53.74%|**62.93%** (185 / 294)|
|**Score with equivalents excluded** ((killed + timeout) ÷ (total − equivalent))|—|**64.24%** (185 / 288), counting timeouts as killed the way Stryker does. Killed only, without timeouts: 59.72% (172 / 288).|

Changes to the properties:

- New properties: R3 (budget), R2 (runner), R4 (one source).
- R3 now also checks the reason recorded for a blocked final-step tool call.
- R2 (markdown) generator: the description line is optional, and the file may also have an invalid mode.
- R4 jsonc generator: optional `$schema` line and the V1 `"mode"` key.

Per-requirement Stryker IDs (_Mutants it kills_ column) come from four extra runs, one per requirement, using `bun test -t "R2"` / `"R3"` / `"R4"` / `"R5"`. Their union is exactly the 185 detected mutants. Many mutants are detected by more than one requirement.

**Equivalent mutants (6): #151, #153, #165, #166, #229, #283**

|ID|Location|Mutation|Why it's equivalent|
|---|---|---|---|
|#153|`llm.ts:187`|`if (promotion)` → `if (true)`|With `promotion` undefined, neither the `"steer"` nor the `"queue"` branch runs, so `promoted` stays 0 and the step counter is not reset. The only extra work is a read-only query for the latest event sequence. Requests, tool runs and session history are the same.|
|#165|`llm.ts:192`|`promoted += …` → `promoted -= …`|`promoted` is only used for `promoted > 0`, which resets the step counter to 1. The queue branch runs only when `promotion` is `"queue"`, which is set only at the start of a run, where the incoming step is already 1. Reset or not, the counter is 1.|
|#166|`llm.ts:193`|`promoted += …` → `promoted -= …`|Same as #165 (also inside the queue branch).|
|#229|`llm.ts:392`|`hasSteer ? false : …` → `hasSteer ? true : …`|This only changes `hasQueue` when `hasSteer` is true. In all three places `hasQueue` is read (lines 393, 395, 396), `hasSteer` being true settles the result before `hasQueue` is looked at. Neither version queries the database for queued input in that case.|
|#151|`agent.ts:196`|`return "unknown error"` → `return ""`|`invalidReason` is called only after a decode has failed. It re-runs the same schema on the same input; the first decode's extra `propertyOrder` option doesn't affect success, and decoding is deterministic. It always throws, so this line is unreachable.|
|#283|`migrate.ts:102`|`if (!entries.length) return undefined` → `if (false) …`|A V1 config with no agents gets `agents: {}` instead of `undefined`. `ConfigMigrateV1.migrate` is called only in `config.ts`, and the only reader of `info.agents` is the agent plugin, which uses `document.info.agents ?? {}`. The two values behave the same.|

**Considered and rejected as equivalent (still counted as survivors):**

- `llm.ts:190` `promotion === "steer"` → `true`: if a steered message arrives between the "is a steer pending?" check and the next turn's queue promotion, the mutant promotes it before the queued message instead of after. That changes the message order, so it's observable (a concurrency race that isn't tested).
- `llm.ts:387` `Effect.fn("SessionRunner.run")` → `Effect.fn("")`: the span name appears in exported traces.
- `agent.ts:170` dropping `^` from the prefix regex: `glob` matches case-insensitively by default on macOS and Windows and returns paths in their on-disk case. A file at `Agents/agent/x.md` keeps its name with the anchored regex, but becomes `Agents/x` without the anchor.

## Agent failure case

> Written with Claude Code instead of opencode, due to hitting opencode usage limit. 

### Transcript excerpt

Full transcript: `mutants/ccao2/agent-transcript.txt`.

**Prompt:**

> Write a fast-check property test for this requirement: "OpenCode rejects a steps value that is not a positive whole number and shows an error naming the field, instead of loading the agent."
> 
> The relevant code is in packages/core/src/config/plugin/agent.ts. Add it as a new test named "claude: R2 rejects non-positive-integer steps" in packages/core/test/steps/config.property.test.ts. Keep the existing fc.configureGlobal({ seed: 42 }). Run it and make sure it passes.

**Response (relevant part):**

> What the test does:
> 
> - Inputs: it uses the file's existing invalidSteps generator: 0 and negative numbers, fractions, NaN, ±Infinity, any string (including "five", "3" and ""), null, and booleans.
> - [...]
> - Checks, over 40 runs:
>     - the invalid agent isn't loaded;
>     - a warning is logged that names both the agent and the steps field;
>     - the valid agent still loads with steps === 3, so one bad file doesn't stop the others loading.
> 
> [...] The new test covers more invalid values than the Markdown test.

The claim "0 and negative numbers, fractions" describes what the generator _could_ produce, not what it _does_ produce in the 40 seeded runs (see below).

### Original property

```ts
  // R2: OpenCode rejects a steps value that is not a positive whole number and shows an
  // error naming the field, instead of loading the agent.
  // Kind: invariant. Draws from the full invalidSteps generator (0/negatives, fractions, NaN,
  // +/-Infinity, arbitrary strings, null, booleans), writes each value into a real agent .md file
  // as a YAML scalar, and loads it through ConfigAgentPlugin: the agent must be absent, a warning
  // must name both the agent and the steps field, and a valid sibling agent must still load.
  test(
    "claude: R2 rejects non-positive-integer steps",
    async () => {
      console.log("[property] claude: R2 ran")
      await fc.assert(
        fc.asyncProperty(invalidSteps, async (steps) => {
          const { agents, logs } = await loadAgents({
            bad: markdownFile(toYamlScalar(steps), "native"),
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
```

### Which mutants survive it

Run with only this property (`bun test test/steps/config.property.test.ts -t "claude: R2"`) against each R2 mutant:

|Mutant|Change|Result|
|---|---|---|
|H4|`invalidReason` returns `"invalid agent configuration"`|Killed (counterexample `[5e-324]`)|
|Stryker #143|`agent.ts:194` `if (legacy)` → `if (true)`|Survived, but equivalent for R2: `ConfigAgentV1.Info` and `ConfigAgent.Info` both use `PositiveInt` for `steps`, so the V1 error text still names `steps`|
|Stryker #151|`agent.ts:196` `"unknown error"` → `""`|Survived, already listed as equivalent (unreachable)|

It kills every non-equivalent R2 survivor, so I tried new mutants of the steps validation:

|Mutant|Change|Result|
|---|---|---|
|**A1**|`config/agent.ts`: `steps: PositiveInt` → `steps: NonNegativeInt` (allows 0)|**Survived**|
|N2|`steps: Schema.Number.check(Schema.isGreaterThan(0))` (allows any positive number)|Killed (`[5e-324]`)|
|N3|`steps: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1))` (forgot the integer check, allows 2.5)|**Survived**|
|N4|`plugin/agent.ts`: on a failed decode, also return a document with `steps` dropped (loads the agent anyway)|Killed (`[5e-324]`)|

### Surviving mutant: A1 (`mutants/ccao2/A1.patch`)

```diff
diff --git a/packages/core/src/config/agent.ts b/packages/core/src/config/agent.ts
index 63df995..405e3ae 100644
--- a/packages/core/src/config/agent.ts
+++ b/packages/core/src/config/agent.ts
@@ -3,7 +3,7 @@ export * as ConfigAgent from "./agent"
 import { Schema } from "effect"
 import { Permission } from "@opencode-ai/schema/permission"
 import { ConfigProvider } from "./provider"
-import { PositiveInt } from "../schema"
+import { NonNegativeInt } from "../schema"
 
 export const Color = Schema.Union([
   Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
@@ -19,7 +19,7 @@ export class Info extends Schema.Class<Info>("ConfigV2.Agent")({
   mode: Schema.Literals(["subagent", "primary", "all"]).pipe(Schema.optional),
   hidden: Schema.Boolean.pipe(Schema.optional),
   color: Color.pipe(Schema.optional),
-  steps: PositiveInt.pipe(Schema.optional),
+  steps: NonNegativeInt.pipe(Schema.optional),
   disabled: Schema.Boolean.pipe(Schema.optional),
   permissions: Permission.Ruleset.pipe(Schema.optional),
 }) {}
```

### Why the property is too weak

**Generator never reaches the bug.** The property needs the input `steps: 0` (A1) or a fraction such as `2.5` (N3), but `fc.integer({ max: 0 }), // 0 and negatives` has an implicit `min` of −2³¹. In the 40 seeded runs it only draws huge negatives (`-1174153639`, `-1773715530`, `-587336077`, `-652936976`, `-2147483628`), and `fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n))` only draws tiny or huge values (`5e-324`, `1.2e-152`, `-1.1e-240`). So `0`, the boundary that the interviews and the P3 acceptance criteria name, is never tested.

Retuning the generator isn't enough. Across 300 seeds, `fc.nat({ max: 1000 })` hit 0 in only 24% of 40-run executions, and even a log-scale, weight-2 generator hit it in only 79%. The fix therefore puts the boundary into the shape of every generated case.

### Strengthened property

```ts
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
```

Changes: (1) every run checks a generated window of whole numbers that always straddles 0/1, plus the same values shifted by a generated fraction, so A1 and N3 are exercised whatever the seed; (2) the oracle checks both sides of the boundary (whole numbers ≥ 1 load with exactly that limit); (3) the warning check matches the quoted agent name, not the substring `bad`.

### Before / after

Before (original property, A1 applied): the mutant survives. (`zz-original.property.test.ts` was a temporary copy of the test file at commit `9d85db1`, deleted after the run.)

```
test/steps/zz-original.property.test.ts:
[property] claude: R2 ran
 1 pass
 0 fail
 120 expect() calls
```

After (strengthened property, A1 applied): killed.

```
error: Property failed after 1 tests
{ seed: 42, path: "0:0:0:0:0:0:0:0", endOnFailure: true }
Counterexample: [5e-324,[0,1,0.01,1.01]]
Shrunk 7 time(s)

270 |             expect(agents[name]).toBeUndefined()
error: expect(received).toBeUndefined()
Received: {
  id: "w0",
  ...
  steps: 0,
}
(fail) agent steps config properties > claude: R2 rejects non-positive-integer steps
 0 pass
 1 fail
```

After, N3 applied: also killed, `Counterexample: [5e-324,[0,1,0.01,1.01]]` (`1.01` loads).

After (strengthened property, clean source): passes.

```
test/steps/config.property.test.ts:
[property] claude: R2 ran
 1 pass
 0 fail
 1017 expect() calls
```

`src/` was confirmed clean (`git status --short packages/core/src` empty) after every mutant run.

## Red team

Mutants by **lilyqin7** (red-team comment on this PR), written against commit `81c4b121b3e3c70b20fd735744799ea6ee9bb57b`. All three change only `packages/core/src/session/runner/max-steps.ts`, which has not changed between that commit and this branch. Each diff was saved to a temp patch file, applied to `ccao2/properties`, run against both property files (`cd packages/core && bun test test/steps/`), and reverted with `git apply -R`. Baseline before any mutant: 9 pass, 0 fail.

| Mutant | Requirement | Change                                                                                                                                                                          | Applied cleanly?                                                                                                                                                                                                          | Result (original properties)                                                                                          | Fix                                                                                                                                                                                                                                                                                       | Result (strengthened properties)                                                                         |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| RT1    | R3          | Final-step instruction: `- List of any remaining tasks that were not completed` becomes `- Briefly describe the overall outcome without discussing unfinished tasks`.           | **No.** The diff's `-`/`+` lines have an extra leading space (`- - List…`), so `git apply` reported `patch failed: max-steps.ts:10`. I applied a corrected copy with the same textual change and without the extra space. | **Survived** (9 pass). R3 only checked that the final request contained `MAXIMUM STEPS REACHED`.                      | R3 and R3 (budget) now require the final request's max-steps instruction to match every entry in `SUMMARY_DEMANDS`: `/summary of what has been accomplished/i` (work done) and `/remaining tasks that were not completed/i` (work remaining). These are the two halves of the revised R3. | **Killed** by **R3** (counterexample `N = 1`) and **R3 (budget)** (counterexample `n = 1`, steer/steer). |
| RT2    | R5          | Plan instruction becomes "Include a short numbered plan describing how you divided the work in your final response.", so the plan comes after the work instead of before tools. | Yes                                                                                                                                                                                                                       | **Survived** (9 pass). R5 only checked for `numbered plan`, the number N, and that exactly one system part was added. | R5 now requires the added plan part to match every entry in `PLAN_DEMANDS`, including `/before your first tool call/i`.                                                                                                                                                                   | **Killed** by **R5** (counterexample `N = 1`).                                                           |
| RT3    | R5          | Plan instruction ends with "then wait for the user to approve the plan." instead of "then start immediately. Do not wait for the user to approve the plan."                     | Yes                                                                                                                                                                                                                       | **Survived** (9 pass). The same gap as RT2: nothing checked the "without waiting for approval" half of R5.            | The same `PLAN_DEMANDS` list includes `/do not wait for the user to approve/i`.                                                                                                                                                                                                           | **Killed** by **R5** (counterexample `N = 1`).                                                           |

No equivalence arguments were needed. Each mutant removes something R3 or R5 explicitly requires (work remaining; plan _before_ tools; _no_ approval wait), so none is behaviourally equivalent.

All of these fixes strengthen existing properties in `packages/core/test/steps/runner.property.test.ts`; no example tests were added. The new checks look for the required instructions in the text the runner actually sends to the model, not by comparing against the `MAX_STEPS_PROMPT` / `stepPlanPrompt` constants, since a mutant that changes the constant would still match itself. After strengthening, the unmutated code passes 9/9, `bun typecheck` is clean, and `max-steps.ts` was confirmed reverted (`git diff --quiet`) after every mutant run.