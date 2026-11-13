# Traceability: Brian Zhang (brianz2)

**Target feature:** Label Service, `packages/core/src/label.ts`, `packages/core/src/label/sql.ts`, `packages/schema/src/label.ts`, `packages/protocol/src/groups/label.ts`, `packages/server/src/handlers/label.ts`, `packages/opencode/src/session/session.ts`, `packages/tui/src/component/dialog-session-label.tsx`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutants it kills |
|---|---|---|---|---|---|---|---|
| R1 | O-5, S-5: labels should be grouped with other labels; unassigning one label should not affect others. | A session must be able to have multiple independent labels. | Given session A and labels `work` and `project`, assign both labels to A. After unassigning `work`, A still has `project` and no longer has `work`. | No | round-trip | Assigning and then unassigning one label returns the session to its prior label set while preserving its other labels | H2, H3 |
| R2 | C-2: labels should never create or delete sessions. S-5: unassigning should not affect the chat. | Assigning or unassigning a label should only change session-label relationships. | Given session A with existing messages and label `work`, assigning or unassigning `work` leaves A's ID, title, messages, and other session fields unchanged, and creates or deletes no sessions. | No | invariant | Label operations preserve the target session row and the set of session IDs | H5 |
| R3 | C-2: the update should appear in the TUI. S-5: the user wants to see whether a label is assigned. | The session label picker must show an assigned indicator exactly when the current session has that label. | Given session A with no labels, the `work` option has no assigned indicator. After assigning `work`, the option shows an assigned indicator. After unassigning it, the indicator is gone. | Yes | - | - | - |
| R4 | C-2: labels should persist across sessions. S-8: a stored label should appear in another tab. O-6: an assigned label should persist. S-9 gives a conflicting preference for a fresh start every session. | Label assignments should remain and persist across and between sessions. | Given session A and label `work`, assign `work` to A. In another open tab, refresh the sessions list and verify that session A still shows `work`. | No | oracle | After each generated assign or unassign operation, `forSession` returns exactly the labels expected for that session | H1, H2, H3, H5 |
| R5 | C-10: the user wants to see the full list of labels. | Opening the session label picker without a filter must list every existing label exactly once, including labels not assigned to the current session. | Given labels `work` and `project` exist and the current session has neither assigned, opening the label picker without a filter shows both labels exactly once. | Yes | - | - | - |
| R6 | S-7: the search should be case-sensitive and should not allow spacing after the colon. | Whitespace immediately after `label:` is ignored, so `label:work`, `label: work`, and `label:    work` produce the same label filter. | Given a session with label `work`, searching with `label:work`, `label: work`, or `label:    work` returns the same label-filtered sessions. | No | - | - | - |
| R7 | S-3: creating an existing label should fail. O-3: labels should not be duplicated. | Labels cannot be created with the same name as an existing label. | Given a label named `work` exists, attempting to create another label named `work` fails with a duplicate-name error and leaves exactly one `work` label. | No | invariant | Case-variant duplicate creation attempts leave exactly one case-insensitive matching label | H4 |

Properties written or suggested by opencode or another AI tool: R1, R2, R4, R7


## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
| R3 | The TUI must clearly show whether a label is assigned or not. | The session label selection in the TUI must show an assigned indicator exactly when the current session has a label, and not show the indicator when the label is not selected, for each label | "Clearly show" is a bit ambigious and not exactly testable. The revision explains the indicator's relationship with each label. |
| R5 | Label search must allow users to view all existing labels. | Opening all sessions with `\session` and typing `label:` must list every existing label exactly once in a dropdown. | "Label search" and "view all" are unclear. The revision makes the searching more explicit and defines how all labels must appear. |


## Hand-written mutants

Each mutant targets `packages/core/src/label.ts` and is saved under `mutants/brianz2/`.

| ID | Requirement targeted | Change | Predicted killer | Actual result |
|---|---|---|---|---|
| H1 | R2, R4 | In `unassign`, filter only by label id rather than both label id and session id, so unassigning a label will unassign that label for all sessions. | None | Killed by R4. Fast-check found a second session unassigning a shared label and causing the first session to lose it. |
| H2 | R1 | In `unassign`, filter only by session id rather than both label id and session id, so unassigning one label unassigns all labels. | R1: A session must be able to have multiple independent labels. | Killed by R1 and R4. R1 observed the other labels disappear; R4 observed the model mismatch. |
| H3 | R4 | In `forSession`, compare `SessionLabelTable.label_id` to `sessionID` which will most likely always return no rows. | R4: Label assignments should remain | Killed by R1 and R4 because assigned labels were never returned. |
| H4 | R7 | In `ensureUniqueName`, change `input.name.toLowerCase()` to just `input.name` so could be same label names with different casing. | R7: no duplicate labels | Killed by R7. The uppercase duplicate reached the database unique constraint instead of producing the expected duplicate-name error. |
| H5 | R2 | Remove `.onConflictDoNothing()` from `assign`, so assigning twice creates a conflict. | R2: Assigning or unassigning a label should only change session-label relationships. | Killed by R2 and R4 because repeated assignment raised a composite-key constraint error. |
