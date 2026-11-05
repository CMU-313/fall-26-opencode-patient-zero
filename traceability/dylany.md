# Traceability: Dylan Yang (dylany)

**Feature:** Label CRUD (#14), in [`packages/core/src/label.ts`](../packages/core/src/label.ts)
**Property tests:** [`packages/core/test/label-crud.property.test.ts`](../packages/core/test/label-crud.property.test.ts)
**Run them:** `cd packages/core && bun test test/label-crud.property.test.ts`

Interview IDs (S-, C-, O-) refer to my Project 3 workbook notes.

## Requirements

| ID | Interview evidence | Requirement | Acceptance criteria | Changed in P4? | Property | Kind | Test | Mutants it kills |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | S-2, C-7, O-2, O-3, O-9 | Deleting a label never deletes the chats tagged with it. | With a chat tagged `School`, deleting `School` leaves the chat in the chat list, and the chat no longer shows `School`. | No | For any label tree, any tagging of up to 4 chats, and any label deleted: every chat still exists, no chat keeps a deleted label, and each chat keeps all its other labels. | Invariant | `label-crud.property.test.ts`: "R1 (invariant): deleting a label never deletes chats" | H1 |
| R2 | C-7, O-3 | Deleting a label also deletes every label nested under it. | With `School` and `School/Databases`, deleting `School` removes both, and listing labels returns neither. | No | For any tree and any label deleted, the deleted IDs and the remaining labels match a simple in-memory model of the label's subtree. | Model / oracle | "R2 (model): deleting a label removes exactly its subtree" | H1 |
| R3 | S-3, C-3, O-4, O-5 | Renaming a label and then renaming it back restores it: same ID, name, parent, creation time, nested labels and tagged chats. Only its last-updated time may change. | Rename `Databases` to `SQL`, then back to `Databases`: the label, its nested labels and the chats tagged with it match their state before the first rename. | **Yes** (see below) | For any tree, any chat tagging, any label and any new name that doesn't collide with a sibling: rename then rename back gives the original label (ignoring last-updated time), the same whole tree and the same chat tags. | Round-trip | "R3 (round-trip): rename then rename back restores the label" | H4; Stryker: `fromRow` dropping timestamps (after P5 fix) |
| R4 | S-4, C-4, O-6 | Label names are trimmed, and two labels under the same parent can't have the same name, ignoring case. | After creating `Homework`, creating `homework`, or `Homework` with extra spaces before and after, fails with a duplicate-name error, and only one `Homework` label exists. | No | For any name (including non-ASCII letters) and any case/whitespace variant of it, creating the variant gives the same result as creating the exact name again: `DuplicateNameError`, with the tree unchanged. Checked at the top level and under a parent. | Metamorphic | "R4 (metamorphic): case and whitespace variants of a sibling name are duplicates"; P5: "R4 (metamorphic): renaming a label to a variant of its own name succeeds" | H3, H6 (H6 after P5 fix) |
| R5 | O-7 | The same name is allowed under different parents. | Creating `Notes` under `Math` and `Notes` under `Art` both succeed, and listing shows `Math/Notes` and `Art/Notes`. | No | For any tree and any name, creating that name under every label in the tree always succeeds, with each copy under its own parent. | Invariant | "R5 (invariant): one name can exist under every different parent" | None of the hand-written mutants (no mutant targeted R5) |
| R6 | O-2 | A label can never be moved under itself or one of its own nested labels. | With `School/Databases`, moving `School` under `Databases` fails with an error, and the tree is unchanged. | No | For any tree and any (label, destination) pair, the move fails with `CycleError` and leaves the tree unchanged exactly when a model says the destination is in the label's own subtree; every other move succeeds. | Model / oracle | "R6 (model): moves into a label's own subtree are rejected, all others succeed" | H2 |
| R7 | S-5, C-5, C-8, O-9 | A rejected label operation fails with a specific error for the reason (not found, invalid name, duplicate name, or cycle), its message names the label involved, and nothing in the label tree changes. | Creating a duplicate `School` returns `DuplicateNameError` whose message includes "School", and no label is created. | **Yes** (see below) | For any tree and any of six invalid operations (duplicate create, missing parent, empty name, move under itself, delete missing, rename missing), the error has the expected type, its message names the label or ID, and the whole tree is unchanged. | Invariant | "R7 (invariant): rejected operations explain why and change nothing"; P5: "R7 (invariant): names over 64 characters are rejected with a clear error, others are kept" | H2, H5; Stryker: name-length limit mutants (after P5 fix) |
| R8 | C-2 | No label operation other than assigning or unassigning changes which labels a chat has. | Creating, renaming or moving labels leaves every chat's set of labels exactly the same. | **Yes** (see below) | For any tree, any chat tagging, and any sequence of up to 8 create/rename/move operations (valid or rejected), every chat has the same set of labels afterward. | Invariant | "R8 (invariant): creating, renaming and moving labels never changes a chat's labels" | H2 (by timing out: the self-parented label makes later moves loop forever) |
| R9 | S-2, O-8 | Listing the top level returns exactly the labels with no parent, and listing a label returns exactly its direct children. | With `School/Math`, `School/Art` and `Personal`, listing the top level returns `School` and `Personal`, and listing `School` returns `Math` and `Art`. | **New in P5** | For any tree, the top-level list and every label's child list match a model computed from the parent-index array. | Model / oracle | "R9 (model): listing by parent matches the tree" | None of the hand-written mutants; Stryker: all four `list()` filter mutants |

All 9 requirements have at least one property (11 properties in total), using 4 kinds: invariant (R1, R5, R7, R8), model / oracle (R2, R6, R9), round-trip (R3) and metamorphic (R4). R9 and the second R4 and R7 properties were added in P5 to kill surviving mutants.

**AI use:** I used Claude to help write all 8 properties and the generators. I reviewed each one against its requirement and the interview evidence, and I'm responsible for their correctness.

## Requirement changes

R1, R2, R4, R5 and R6 are kept as written. Each one already states an exact outcome that a test can check for any input.

| ID | Original (P3) | Revised (P4) | Why it changed |
| --- | --- | --- | --- |
| R3 | Renaming a label and then renaming it back restores its original state. | Renaming a label and then renaming it back restores it: same ID, name, parent, creation time, nested labels and tagged chats. Only its last-updated time may change. | **Feasibility / checkability.** "Original state" includes the last-updated timestamp, which every write must change, so the requirement as written can't be met. What interviewees cared about was that nothing they see is lost: the same chats and nested labels (C-3, O-5) and the same name (O-4). The revision keeps all of that and drops only the timestamp. |
| R7 | A failed label operation returns an error that says why it failed. | A rejected label operation fails with a specific error for the reason (not found, invalid name, duplicate name, or cycle), its message names the label involved, and nothing in the label tree changes. | **Checkability.** "Says why it failed" can't be checked automatically. Interviewees wanted to know what went wrong (C-5, C-8 "Error: label already exists") and the exact conflict (O-9). The revision makes that concrete: a fixed error type per reason and a message naming the label. It also adds "nothing changes", because a failed operation that half-applies would be the worst version of "wrong result". |
| R8 | Labels are only assigned to a chat when the user explicitly assigns them. | No label operation other than assigning or unassigning changes which labels a chat has. | **Checkability.** The service can't tell whether a user "explicitly" meant to do something, so the original can't be tested. My classmate's concern (C-2) was labels showing up on chats without their permission. The revision captures that as a checkable rule: only assign and unassign may change a chat's labels. |

## Triage log (Step 3)

| Property | Result on first run | Shrunk counterexample | Outcome | What I did |
| --- | --- | --- | --- | --- |
| R4 | Failed | Name `"É"`, variant `"É"` (an exact duplicate), top level | **Code bug** | The duplicate check compared SQLite's `lower(name)` with JavaScript's `toLowerCase()`. SQLite's `lower()` only lowercases ASCII letters, so for `"É"` the check missed the duplicate. The insert then hit the database's unique index and crashed with a raw database error (a 500 over HTTP) instead of `DuplicateNameError`. The same mismatch let `"É"` and `"é"` both exist as siblings. **Fix:** `ensureUniqueName` in `label.ts` now loads the siblings' names and compares them in JavaScript, so case is folded the same way for every letter. |
| R8 | Failed | One chat tagged with two labels, then rename one to `"Ca"` | **Wrong test** | The chat kept exactly the same two labels; only their order changed, because `forSession` sorts by name and the rename changed the sort order. My property compared lists, but R8 is about which labels a chat has. **Fix:** the property now compares each chat's labels as a sorted set. |
| R1, R2, R3, R5, R6, R7 | Passed | | | No change needed. |

After both fixes, all 8 properties pass (60 generated cases each), along with the 32 existing label tests.

## Hand-written mutants (P5)

Patches are in [`mutants/dylany/`](../mutants/dylany/). To run one: `git apply mutants/dylany/H1.patch`, run `cd packages/core && bun test test/label-crud.property.test.ts`, then `git checkout -- packages/core/src/label.ts`. Each prediction was written down before the mutant was run. Results below use the fixed fast-check seed `3132026`.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
| --- | --- | --- | --- | --- |
| H1 | R2 | `subtree()` uses `if` instead of `while`, so deleting a label only collects its direct children. Looks like a harmless "one query is enough" simplification. | R2 (model): any tree where the deleted label has grandchildren. R1 might also fail. | **Killed** by R1 and R2. The grandchildren are left pointing at a deleted parent, so the delete fails the foreign-key check. |
| H2 | R6 | The cycle check starts walking from the new parent's *parent*, so the case "move a label under itself" is never checked. A classic off-by-one at the start of a loop. | R6 (when moved == destination) and R7 (its "cycle" case moves a label under itself). | **Killed** by R6, R7 and, unexpectedly, R8. R8 timed out: once a label is its own parent, the next cycle check on it walks up the chain forever. So one missed check turns into an infinite loop later. |
| H3 | R4 | `normalizeName` checks the trimmed name but returns the untrimmed one. | R4: a padded variant like `" Homework "` is no longer seen as a duplicate. | **Killed** by R4. After P5 it is also killed by the second R4 property and by the new R7 name-length property, since the stored padding counts toward the length. |
| H4 | R3 | A rename-only update computes `parentID = input.parentID ?? null` instead of keeping the current parent, so renaming a nested label silently moves it to the top level. An undo that "restores everything except one field". | R3 (round-trip): renaming a nested label and back changes its parent. | **Killed** by R3. |
| H5 | R7 | `remove()` returns `[]` for a missing label instead of failing with `NotFoundError`. A silently swallowed error. | R7: its "delete missing" case expects `NotFoundError`. | **Killed** by R7. |
| H6 | R4 | The duplicate check no longer excludes the label being renamed, so fixing "homework" to "Homework" fails with "already exists" against itself. | **Predicted to survive.** No property renamed a label to a case variant of its own name. R3 would only catch it if its random new name happened to match the old one ignoring case. | **Survived**, as predicted. **Fixed in P5** by a new R4 property, "renaming a label to a variant of its own name succeeds", which now kills it (counterexample: rename `"Éb5Ü"` to `"Éb5ü"`). |

All 6 hand-written mutants are now killed.

## Stryker comparison (P5)

**Setup:** [`packages/core/stryker.dylany.config.json`](../packages/core/stryker.dylany.config.json), run with `cd packages/core && bunx stryker run stryker.dylany.config.json`. It uses the `command` runner with `bun test test/label-crud.property.test.ts`, so only my property tests run, and `coverageAnalysis: "off"`. My feature lives in `packages/core`, so Stryker is installed and configured there instead of `packages/opencode`. `mutate` is limited to the parts of `label.ts` my requirements cover: the error classes, `normalizeName`, and `create`, `get`, `list`, `update` and `remove` (lines 1 to 62, 104 to 259, and 336). The same file also holds teammates' code (`resolvePath`, `assign`, `unassign`, `forSession`), which my requirements don't cover. `inPlace` is on because the test file imports `@opencode-ai/core/...`, which would otherwise resolve to the unmutated original instead of Stryker's sandbox copy. A scoped run takes about 2.5 minutes. Report: [`mutants/dylany/mutation.html`](../mutants/dylany/mutation.html).

**fast-check seed:** `3132026`, set as `seed` in the shared `RUNS` options passed to every `fc.assert` in `label-crud.property.test.ts`, so local, CI and Stryker runs all generate the same cases.

**Mutation score**

| Run | Mutants | Killed | Timed out | Survived | Score |
| --- | --- | --- | --- | --- | --- |
| Exploratory run on all of `label.ts` (including teammates' code), P4 properties | 180 | 101 | 2 | 77 | 57.2% |
| Scoped config, P4 properties (before strengthening) | 118 | 90 | 2 | 26 | 78.0% |
| Scoped config, final properties, as Stryker reports it | 118 | 101 | 2 | 15 | **87.3%** |
| Scoped config, final properties, equivalent mutants excluded | 103 | 101 | 2 | 0 | **100%** |

Strengthening done in P5, using properties only. It killed 11 of the 26 survivors:
- **R3:** the round-trip property now also checks that timestamps are still real numbers. Before, `fromRow` returning `time: {}` survived, because `undefined === undefined`.
- **R7, new property:** name lengths of 55 to 75 characters. The old name generator never went past 20 characters, so dropping the 64-character limit (`if (false)`), changing `>` to `>=`, and blanking the error's reason all survived.
- **R9, new requirement and property:** a model check for `list({ parentID })`. Nothing called `list` with a filter, so all four mutants in its filter survived.
- **R4, second property (renaming a label to a variant of its own name):** besides H6, it kills two Stryker mutants on the no-op check in `update` (`name === current.name` forced to `true` or flipped), which made a case-only rename return the old name unchanged.

**Equivalent mutants (15)**
- **Span names (6):** `Effect.fn("Label.create")` to `Effect.fn("")`, and likewise for `get`, `list`, `update` and `remove`, plus the service key `"@opencode/Label"` to `""`. These strings only name tracing spans and the dependency-injection key. No other service uses an empty key, so nothing a caller can observe changes.
- **Error field schemas (4):** `NotFoundError`, `InvalidNameError`, `DuplicateNameError` and `CycleError` with `{}` instead of their field schemas. The constructor still stores the fields at runtime, so `_tag`, `message` and `id` are unchanged, and R7 still sees them. The schemas would only matter if the error were encoded directly, but the HTTP layer builds its own error types from these values.
- **`if (parentID !== null)` to `if (true)` around the cycle check:** when `parentID` is `null`, the `while (cursor !== null)` loop inside runs zero times anyway, so the result is identical.
- **No-op short-circuit removed (`if (false) return fromRow(current)`):** without it, an update that changes nothing runs the duplicate check (which excludes the label itself, so it always passes) and rewrites the same values. The only difference is the last-updated timestamp, which R3 explicitly allows to change. So no requirement can tell the two apart.
- **Two mutants on `if (!row)` after the update:** that branch only runs if another caller deletes the label between `requireRow` and the `UPDATE` a few lines later. Within one service call on one SQLite connection that can't happen, so the branch is unreachable in practice.
- **`deps: [Database.node]` to `deps: []`:** the database layer is still built because many other nodes declare it (Session, Event, Credential, PermissionSaved and others), so `Label` always receives it in any real app graph and in the tests.

**Hand-written mutants Stryker never generated, and why**
- **H2 (cycle walk starts one step late), H4 (rename resets the parent) and H6 (duplicate check forgets to exclude itself):** Stryker only makes small, local edits, like flipping an operator, emptying a block, or replacing a condition with `true`/`false`. It never moves where a loop starts, replaces a whole expression with a different valid one, or deletes one argument from an object. Those are the "almost right" bugs a developer writes when refactoring, and H6 was the only hand-written mutant that survived.
- **H1 and H5:** Stryker generated close cousins (emptying the `while` body, conditions forced to `true`/`false`) but not the exact readable versions I wrote.

**Stryker survivors I wouldn't have thought of**
- **`trimmed.length > MAX_NAME_LENGTH` to `>=`, and the check removed entirely:** I never considered the 64-character limit, because none of my interviewees mentioned it. A real developer could easily write the off-by-one, so this exposed a real gap in my generator.
- **`list()` filter mutants:** I had forgotten that filtering by parent is behavior at all, because my requirements were about writes. A developer could plausibly break `isNull` vs `eq` when refactoring.
- **`fromRow` dropping `time`:** a plausible typo, and it showed that my round-trip property compared `undefined` to `undefined` without noticing.
- **Span names and error schemas:** a real developer could write these, but they don't affect anything a user sees.

**What each approach finds that the other doesn't**
Hand-written mutants come from the requirements, so they test whether each property protects the behavior users asked for, with realistic multi-token bugs like H4 and H6. They can't cover the whole file, and I only write the bugs I already suspect. Stryker is exhaustive and unbiased: it found code paths no requirement mentioned (the length limit and `list` filters) and weak assertions (`time`). But it also produces noise (span names, unreachable branches) that has to be argued away, and it misses bugs that need more than a one-token change.

## Agent failure case (P5)

_To do: none of my properties were written by opencode, so I'll ask opencode to write one for a requirement and run my mutants against it. Then I'll record the transcript excerpt, the `/share` link, the surviving mutant, why the property was too weak, and the strengthened version with evidence it kills the mutant._

## Red team (P5)

_Optional extra credit. To be filled in if I sign up._
