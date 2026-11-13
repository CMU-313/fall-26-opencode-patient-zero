# Traceability: Tate Suarez (tsuarez)

**Target feature:** Session labels, meaning assigning labels to sessions and the /label TUI command. Core assign, unassign and per-session listing in `packages/core/src/label.ts`, HTTP API definition in `packages/protocol/src/groups/label.ts`, HTTP handlers in `packages/server/src/handlers/label.ts`, TUI /label dialog in `packages/tui/src/component/dialog-session-label.tsx`, and command registration in `packages/tui/src/component/prompt/index.tsx`.

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | O-13: "If you delete the label, it just goes back into unfiled" | A session with no labels is listed under an "Unfiled" view. This includes a session whose last label was removed. A session with at least one label is not listed there. | Session A has no labels and session B has "work". The Unfiled view lists A and not B. After "work" is removed from B, the Unfiled view lists both A and B. | Yes | None yet. The code has no Unfiled view to test against. | None | None (no properties) |
| R2 | S-16, S-18, S-19: "I don't think anything should change" | Adding a label the session doesn't already have and then removing it leaves the session's labels exactly as they were before. Adding a label the session already has changes nothing. | Session C has ["work"]. Adding and then removing "school" leaves C with ["work"]. Adding "work" again leaves C with ["work"], with no duplicate. | Yes | (1) For any labels a session starts with, adding a label it doesn't have and then removing it gives back exactly the starting labels, and a second session holding every label is left unchanged (round-trip). (2) Adding a label the session already has, 1 to 5 times, leaves its labels unchanged with no duplicates (invariant). (3) Any sequence of adds and removes leaves the session with the same labels as a plain set given the same steps (model / oracle). | (1) [R2: adding then removing a new label leaves the session's labels unchanged](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/core/test/label/label.property.test.ts#L52-L90) (2) [R2: adding a label the session already has changes nothing, however many times](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/core/test/label/label.property.test.ts#L92-L125) (3) [R2: any sequence of adds and removes matches a simple set model](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/core/test/label/label.property.test.ts#L127-L157) | H1, H2 (after strengthening) |
| R3 | O-26, O-27: "I don't think trailing spaces should be allowed" | Label names are trimmed of leading and trailing spaces when they are created or assigned. | When the label "Work" exists, typing "Work " does not create a new label. The label list still contains exactly one "Work", and the session gets that label. | No | For any existing label name, top-level or nested, including non-ASCII and 64-character names, adding spaces or tabs before or after it never creates a second label. The padded name is rejected as a duplicate, and the list still has exactly one label with the trimmed name (metamorphic). | [R3: a name with extra spaces around it never creates a second label](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/core/test/label/label.property.test.ts#L159-L193) | H3; Stryker line 156 (after strengthening) |
| R4 | S-28, S-29, O-28, O-29, O-30: "I would expect to get all sessions with that label" | Filtering by a label returns every session that has that label and no session that doesn't. | The Monday session has "chicken", the Tuesday session has "chicken" and "work", and the Friday session has "work". Filtering by "chicken" returns exactly the Monday and Tuesday sessions. | No | For any 1 to 6 sessions, each holding any subset of the labels "chicken", "work", and "lunch", filtering by one of those labels or by "dinner" (a name no label has) returns exactly the sessions a plain list says have it (model / oracle). | [R4: filtering by a label returns exactly the sessions that have it](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/opencode/test/label/label.property.test.ts#L56-L85) | H4 (after strengthening) |
| R5 | S-30, S-32, S-33, O-31, O-32: "Maybe the conversations have like a timestamp next to them" | Each session in filter results shows the date and time of its last message. Adding or removing labels does not change this time. | The Tuesday session from R4 has its last message on Nov 3, 2026 at 3:00 PM. Filtering by "chicken" shows "Nov 3, 3:00 PM" next to it. Adding the label "lunch" to it still shows Nov 3, 3:00 PM. | Yes | For any session time between 2020 and 2030 and any sequence of label adds and removes, the session's time is unchanged afterwards (invariant). | [R5: adding or removing labels never changes a session's time](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/core/test/label/label.property.test.ts#L195-L230) | H1, H5 |
| R6 | S-32, S-33, O-32, C-27, C-28: "If it's ordered by, like, most recent" | Filter results are sorted by the time of each session's last message, newest first. | The Tuesday session's last message is Nov 3, 2026 at 3:00 PM, and the Monday session's is Nov 2, 2026 at 10:00 AM. Filtering by "chicken" lists Tuesday first, then Monday. Adding a label to Monday does not move it above Tuesday. | Yes | (1) For any sessions with distinct times, filter results are in newest-first order (invariant). (2) Adding another label to any session leaves the order of the filter results unchanged; the only change allowed is that session joining the results when the added label is the filter label (metamorphic). | (1) [R6: filter results are sorted newest first](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/opencode/test/label/label.property.test.ts#L87-L115) (2) [R6: adding a label to a session does not change the order](https://github.com/CMU-313/fall-26-opencode-patient-zero/blob/880c6a823dd2015b22c8741cefee60f42613382e/packages/opencode/test/label/label.property.test.ts#L117-L157) | H1, H5 |

The P3 example row (R1, permission rules) was removed, so the P3 requirements were renumbered. P3 R2 through R7 are now R1 through R6.

Properties written or suggested by opencode or another AI tool: R2, R3, R4, R5, R6. Claude Code assisted in writing/reviewing/enhancing the quality of all of these properties and their generators, and I reviewed each one against its requirement.

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 (P3 R2) | A session with no labels is listed under an “Unfiled” view. Acceptance criteria: After the R1 scenario, the Unfiled view lists session A but not session B. | A session with no labels is listed under an "Unfiled" view. This includes a session whose last label was removed. A session with at least one label is not listed there. | The requirement could be built, but its test could not be checked. It started from the template example's scenario, which is about permission rules and never creates session A or session B. All three interviewees said removing a label should never remove the session (C-10, S-13, O-15), and O-13 wanted those sessions to go back into an unfiled category. The revised test covers that case directly. |
| R2 (P3 R3) | Adding a label to a session and then removing it leaves the session’s labels exactly as they were before. | Adding a label the session doesn't already have and then removing it leaves the session's labels exactly as they were before. Adding a label the session already has changes nothing. | As written it fails when the session already has the label. Adding a duplicate does nothing, and removing it then deletes a label the session had before. Users wanted a round trip with no side effects (S-18, S-22), and all three said adding the same label twice should leave one tag (C-18, O-21, O-22). |
| R5 (P3 R6) | Each session in filter results shows its last-updated date and time, and the results are sorted newest first. | Each session in filter results shows the date and time of its last message. Adding or removing labels does not change this time. | It was word for word the same as R6, so it now covers only the timestamp. "Last updated" was undefined. If labeling counted as an update, a round trip would change the session, which conflicts with R2. The old test used relative dates, so its result depended on the day it ran, and it pointed to the wrong requirement for the Tuesday session. S-32 asked for a "last edited" or "last modified" time so a missing session is easier to notice (S-33, O-32). |
| R6 (P3 R7) | Each session in filter results shows its last-updated date and time, and the results are sorted newest first. | Filter results are sorted by the time of each session's last message, newest first. | It was a copy of R5, so it now covers only the ordering. It had the same undefined "last updated" and date-dependent test. If labeling bumped a session's time, labeling would move it to the top of the list, which conflicts with R2. The ordering evidence comes mainly from C-28, which is partly unclear on the recording, with support from S-33. |

## Hand-written mutants

Each mutant is a patch in `mutants/tsuarez/`. To run one: `git apply mutants/tsuarez/H1.patch`, run `bun test test/label/label.property.test.ts` in `packages/core` and `packages/opencode`, then `git apply -R mutants/tsuarez/H1.patch`. Predictions were written before any mutant was run.

**AI assistance.** Claude Code assisted in improving the mutants after I made attempts.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R2 | `label.ts`: `assign` drops `.onConflictDoNothing()`, so adding a label the session already has hits the primary key and crashes instead of being a no-op | "Adding a label the session already has changes nothing" (R2 invariant) and "any sequence of adds and removes matches a simple set model" (R2 model / oracle) | Killed by both predicted R2 properties. Shrunk counterexample: one label "work" added twice. Also killed by R5 and by R6 (metamorphic), because their generators add labels a session may already have. |
| H2 | R2 | `label.ts`: `unassign` filters only by label ID and drops the session ID condition, so removing a label from one session removes it from every session | None. Every R2 property uses a single session, so the label disappearing from other sessions is never observed | Survived, as predicted. The R2 generators never create a second session holding the same label. |
| H3 | R3 | `label.ts`: `normalizeName` uses `trimEnd()` instead of `trim()`, so trailing spaces are removed but leading ones are kept | "A name with extra spaces around it never creates a second label" (R3 metamorphic), because the padding generator adds whitespace on the left as well as the right | Killed by the R3 property. Shrunk counterexample: `["work", "\t", ""]`, a single leading tab. |
| H4 | R4 | `session.ts`: when a label name matches no label, the list drops the label filter instead of returning `[]` (presented as avoiding an empty `IN ()`), so filtering by an unknown label lists every session | None. The R4 generator always creates all three pool labels, so it never filters by a name that matches no label | Survived, as predicted. The generator has no case for a label name that doesn't exist. |
| H5 | R5, R6 | `label.ts`: `assign` also sets the session's `time_updated` to now, presented as "so clients re-sync its label list" | "Adding or removing labels never changes a session's time" (R5 invariant) and "adding a label to a session does not change the order" (R6 metamorphic) | Killed by both. R5 counterexample: one add to a session dated Jan 1, 2020. R6 counterexample: re-adding "chicken" to the newer of two "chicken" sessions reset its time to the real current time, which is earlier than its generated late-November date, so it dropped below the other session. |

All five predictions matched. H2 and H4 point to gaps in the generators: R2 needs a second session sharing the label, and R4 needs a filter name that no label has.
## Stryker comparison

**Setup.** `packages/core/stryker.tsuarez.config.json` runs only my core property file (R2, R3, R5) and mutates only the `label.ts` functions those properties call: `normalizeName`, `ensureUniqueName`, `create`, `assign`, `unassign`, and `forSession`. It uses `inPlace: true` because the tests import the real source file, not a sandbox copy. The fast-check seed is fixed at **42**, two runs gave identical results, and the report is in `mutants/tsuarez/mutation.html`.

**AI Disclosure:** Claude drafted the answers below from the Stryker report. I reviewed the survivors and the answers.

R4 and R6 are tested in `packages/opencode`, where Stryker is not installed, so the session-list filter code they cover is not part of this run.

**Mutation score: 72.00%** (50 mutants: 36 killed, 14 survived, 0 timeouts, 0 errors).

| Line | Stryker survivor | What it means |
|---|---|---|
| 122 | `if (!trimmed)` → `if (false)` | A whitespace-only name is accepted and creates a label with an empty name |
| 122 | `InvalidNameError({ name, reason })` → `InvalidNameError({})` | The empty-name error loses its details |
| 122 | `reason: "name cannot be empty"` → `reason: ""` | Same, reason text only |
| 123 | `if (trimmed.length > MAX_NAME_LENGTH)` → `if (false)` | Names longer than 64 characters are accepted |
| 125 | `InvalidNameError({ name, reason })` → `InvalidNameError({})` | The too-long error loses its details |
| 125 | reason template → empty template | Same, reason text only |
| 156 | `input.parentID === null ? isNull(...) : eq(...)` → `false ? ...` | For top-level labels the sibling query becomes `parent_id = NULL`, which matches nothing in SQL, so top-level duplicate names are not detected and crash on the unique index |
| 187 | `Effect.fn("Label.create")` → `Effect.fn("")` | Tracing span name only |
| 190 | `if (parentID !== null) requireRow(parentID)` → `if (false)` | Creating a label under a missing parent crashes on the foreign key instead of returning NotFoundError |
| 295 | `Effect.fn("Label.assign")` → `Effect.fn("")` | Tracing span name only |
| 303 | `if (!session)` → `if (false)` | Assigning to a missing session crashes on the foreign key instead of returning SessionNotFoundError |
| 303 | `SessionNotFoundError({ sessionID })` → `SessionNotFoundError({})` | The error loses its session ID |
| 312 | `Effect.fn("Label.unassign")` → `Effect.fn("")` | Tracing span name only |
| 320 | `Effect.fn("Label.forSession")` → `Effect.fn("")` | Tracing span name only |

**Which of my hand-written mutants did Stryker never generate, and why?**
None of them. Stryker doesn't delete calls from a method chain (H1), drop function arguments (H2), swap `trim()` for `trimEnd()` (H3; it only removed `trim()` entirely, which R3 killed), or add new code (H5), and H4 is in `session.ts`, outside its scope. Each hand-written mutant needed knowledge of what the feature should do, while Stryker makes small syntactic edits one location at a time.

**Which Stryker survivors would I never have thought of? Are any of them plausible real bugs?**
I would not have thought of line 156, which showed that R3 only tested nested labels, never top-level ones. It is a very plausible bug, since forgetting to special-case `null` is easy and SQL's `= NULL` never matches. Removing the missing-parent and missing-session checks (190, 303) is also plausible because foreign keys still block bad rows, while the empty-error and span-name mutants are not bugs anyone would write.

**What does each approach find that the other doesn't?**
Hand-written mutants found gaps in what my properties check: R2 never looked at other sessions (H2), and R4 never filtered by a name with no label (H4). Stryker found code paths my generators never reach: top-level duplicates (156) and the validation and not-found branches (122, 123, 190, 303). Those branches cover cases no requirement mentions, so Stryker also exposed missing requirements, which no single-token hand edit would have shown.

## Strengthening

All changes are to properties and generators; no example-based tests were added. The seed stays at 42. Claude Code wrote the property and generator changes and the equivalent-mutant arguments, and I reviewed each change against its requirement.

| Survivor | Change to the property | Result |
|---|---|---|
| H2 (R2) | The R2 round-trip property now creates a second session holding every label and checks that its labels are unchanged after the round trip on the first session. | Killed by "R2: adding then removing a new label leaves the session's labels unchanged". |
| H4 (R4) | The R4 generator can now filter by "dinner", a name no label has, in addition to the three pool labels. The oracle expects no sessions for it. | Killed by "R4: filtering by a label returns exactly the sessions that have it". |
| Stryker line 156 (R3) | The R3 generator now chooses between a top-level label and a nested one, so the `parent_id IS NULL` branch of the duplicate check is exercised. | Killed by "R3: a name with extra spaces around it never creates a second label". |

After strengthening, all five hand-written mutants (H1-H5) are killed.

**Equivalent mutants (4).** Each changes the name passed to `Effect.fn` to an empty string.

- **Line 187, `Effect.fn("Label.create")` → `Effect.fn("")`:** The string passed to `Effect.fn` only names the tracing span recorded for the call. It does not affect the return value, the errors raised, or anything written to the database, and nothing in the program reads span names back. No test can tell the difference without inspecting tracer output, so the mutant is equivalent.
- **Line 295, `Effect.fn("Label.assign")` → `Effect.fn("")`:** Same reasoning: only the span name for `assign` changes, while the label assignment it performs and its errors are identical.
- **Line 312, `Effect.fn("Label.unassign")` → `Effect.fn("")`:** Same reasoning: only the span name for `unassign` changes, and the delete it runs is identical.
- **Line 320, `Effect.fn("Label.forSession")` → `Effect.fn("")`:** Same reasoning: only the span name for `forSession` changes, and the labels it returns are identical.

**Remaining survivors that are not equivalent (9).** These change real behavior, but only in cases none of R1-R6 describe, so I did not write properties for them: an empty or whitespace-only name being accepted (line 122), names over 64 characters being accepted (line 123), the two invalid-name errors losing their `name` and `reason` (lines 122 and 125, four mutants), creating a label under a missing parent crashing instead of returning NotFoundError (line 190), and assigning to a missing session crashing instead of returning SessionNotFoundError, or that error losing its session ID (line 303, two mutants). Killing them would need new requirements for name validation and missing-record errors, which none of my interviews covered.

**Final mutation score:**

| | Killed | Total | Score |
|---|---|---|---|
| Before strengthening (Stryker) | 36 | 50 | 72.00% |
| After strengthening, as Stryker reports it | 37 | 50 | **74.00%** |
| After strengthening, equivalent mutants excluded | 37 | 46 | **80.43%** |

## Agent failure case

**Property:** opencode wrote "R2: adding a missing label then removing it restores the session's labels" in `packages/core/test/label/opencode-r2.property.test.ts` (the first test in that file, unchanged from opencode's output). I asked it to write a property for R2 without reading my existing property tests.

**opencode transcript excerpt:**

**Prompt:** Write a fast-check property for this requirement: "R2: Adding a label the session doesn't already have and then removing it leaves the session's labels exactly as they were before." Test Label.Service (assign, unassign, forSession) in packages/core/src/label.ts. Do not read or copy anything in packages/core/test/label/ or packages/opencode/test/label/. Put it in packages/core/yesy/label/opencode-r2.property.test.ts.


**Response:** 
1 pass
0 fail
180 expect() calls
Ran 1 test across 1 file. [1.89s]
$ cd packages/core && bun typecheck
$ tsgo --noEmit
+ Thought: 754ms
Created packages/core/yesy/label/opencode-r2.property.test.ts.
The property generates 1–8 unique labels plus an initial assignment subset, picks an unassigned label, then verifies assign adds it and unassign restores forSession exactly. Test passes with 60 runs; typecheck is clean.


**Share link:** https://opncd.ai/share/0ksujzEx

**Mutant it let survive:** H2. In `label.ts`, `unassign` filters only by label ID and drops the session ID condition, so removing a label from one session removes it from every session. With H2 applied, opencode's property passes (1 pass, 0 fail).

**Why the property was too weak:** The generator never reaches the bug. Every scenario creates exactly one session (`ses_r2`), and the property only compares that session's labels before and after the round trip. With a single session, "remove this label from this session" and "remove this label from every session" leave the database in the same state, so H2 is indistinguishable from correct code. The assertions themselves are sound (the session's labels must match exactly), but nothing in the input ever puts the same label on a second session.

**Strengthened version:** The second test in the same file, "R2 (strengthened): the round trip on one session leaves every other session's labels alone". It was written with Claude Code, not opencode, and I reviewed it against R2. It reuses opencode's generator and setup, then adds a second session (`ses_r2_other`) holding every label before the round trip, and asserts that its labels are unchanged afterwards in addition to opencode's original check.

**Evidence that it kills the mutant** (`git apply mutants/tsuarez/H2.patch`, then `bun test test/label/opencode-r2.property.test.ts` in `packages/core`):

```
(pass) R2: adding a missing label then removing it restores the session's labels
Counterexample: [{"names":["a"],"assigned":[false],"pick":0}]
(fail) R2 (strengthened): the round trip on one session leaves every other session's labels alone
 1 pass
 1 fail
```

Without the mutant, both tests pass (2 pass, 0 fail). The shrunk counterexample shows the smallest case: one label "a" that the session doesn't have. After adding and removing it, H2 also strips "a" from the second session.
