# Traceability: Dylan Yang (dylany)

**Feature:** Label CRUD (#14), in [`packages/core/src/label.ts`](../packages/core/src/label.ts)
**Property tests:** [`packages/core/test/label.property.test.ts`](../packages/core/test/label.property.test.ts)
**Run them:** `cd packages/core && bun test test/label.property.test.ts`

Interview IDs (S-, C-, O-) refer to my Project 3 workbook notes.

## Requirements

| ID | Interview evidence | Requirement | Acceptance criteria | Changed in P4? | Property | Kind | Test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R1 | S-2, C-7, O-2, O-3, O-9 | Deleting a label never deletes the chats tagged with it. | With a chat tagged `School`, deleting `School` leaves the chat in the chat list, and the chat no longer shows `School`. | No | For any label tree, any tagging of up to 4 chats, and any label deleted: every chat still exists, no chat keeps a deleted label, and each chat keeps all its other labels. | Invariant | `label.property.test.ts`: "R1 (invariant): deleting a label never deletes chats" |
| R2 | C-7, O-3 | Deleting a label also deletes every label nested under it. | With `School` and `School/Databases`, deleting `School` removes both, and listing labels returns neither. | No | For any tree and any label deleted, the deleted IDs and the remaining labels match a simple in-memory model of the label's subtree. | Model / oracle | "R2 (model): deleting a label removes exactly its subtree" |
| R3 | S-3, C-3, O-4, O-5 | Renaming a label and then renaming it back restores it: same ID, name, parent, creation time, nested labels and tagged chats. Only its last-updated time may change. | Rename `Databases` to `SQL`, then back to `Databases`: the label, its nested labels and the chats tagged with it match their state before the first rename. | **Yes** (see below) | For any tree, any chat tagging, any label and any new name that doesn't collide with a sibling: rename then rename back gives the original label (ignoring last-updated time), the same whole tree and the same chat tags. | Round-trip | "R3 (round-trip): rename then rename back restores the label" |
| R4 | S-4, C-4, O-6 | Label names are trimmed, and two labels under the same parent can't have the same name, ignoring case. | After creating `Homework`, creating `homework`, or `Homework` with extra spaces before and after, fails with a duplicate-name error, and only one `Homework` label exists. | No | For any name (including non-ASCII letters) and any case/whitespace variant of it, creating the variant gives the same result as creating the exact name again: `DuplicateNameError`, with the tree unchanged. Checked at the top level and under a parent. | Metamorphic | "R4 (metamorphic): case and whitespace variants of a sibling name are duplicates" |
| R5 | O-7 | The same name is allowed under different parents. | Creating `Notes` under `Math` and `Notes` under `Art` both succeed, and listing shows `Math/Notes` and `Art/Notes`. | No | For any tree and any name, creating that name under every label in the tree always succeeds, with each copy under its own parent. | Invariant | "R5 (invariant): one name can exist under every different parent" |
| R6 | O-2 | A label can never be moved under itself or one of its own nested labels. | With `School/Databases`, moving `School` under `Databases` fails with an error, and the tree is unchanged. | No | For any tree and any (label, destination) pair, the move fails with `CycleError` and leaves the tree unchanged exactly when a model says the destination is in the label's own subtree; every other move succeeds. | Model / oracle | "R6 (model): moves into a label's own subtree are rejected, all others succeed" |
| R7 | S-5, C-5, C-8, O-9 | A rejected label operation fails with a specific error for the reason (not found, invalid name, duplicate name, or cycle), its message names the label involved, and nothing in the label tree changes. | Creating a duplicate `School` returns `DuplicateNameError` whose message includes "School", and no label is created. | **Yes** (see below) | For any tree and any of six invalid operations (duplicate create, missing parent, empty name, move under itself, delete missing, rename missing), the error has the expected type, its message names the label or ID, and the whole tree is unchanged. | Invariant | "R7 (invariant): rejected operations explain why and change nothing" |
| R8 | C-2 | No label operation other than assigning or unassigning changes which labels a chat has. | Creating, renaming or moving labels leaves every chat's set of labels exactly the same. | **Yes** (see below) | For any tree, any chat tagging, and any sequence of up to 8 create/rename/move operations (valid or rejected), every chat has the same set of labels afterward. | Invariant | "R8 (invariant): creating, renaming and moving labels never changes a chat's labels" |

All 8 requirements have a property, using 4 kinds: invariant (R1, R5, R7, R8), model / oracle (R2, R6), round-trip (R3) and metamorphic (R4).

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
