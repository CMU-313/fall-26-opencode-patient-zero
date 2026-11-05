# Traceability: Jarrett Huang (jarretth)

**Target feature:** Adding labels to organize conversations, packages/core/src/label.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-4, O-4: "The child label should not change at all (naming, modifications)" | Adding a parent label to an existing label will not change that existing label's name | **Given** an existing label A, **when** label A is added as a child to another label B, **then** label A keeps its original name | No | Invariant | Label's name should not change after being added as a child |
| R2 | C-4, O-4: "the conversations with the child label shouldn't change" | When adding a label A as a child to another label B, any conversations under label A will remain unchanged and not have extra labels appended to them | **Given** an existing label A with conversations tagged to it, **when** label A is added as a child to another label B, **then** conversations with label A remain unchanged and label B is not added to those conversations | No | Invariant | Labeled conversations should not change or have more/less labels if its label is added as a children |
| R3 | C-6, S-8, O-6: "Any conversations with the label will no longer have that label. The label entry itself would also be deleted." | Creating a label and then deleting it will remove that label from the database without affecting any of its conversations | **Given** there are no previously created labels, **when** a label is created and then deleted, **then** getting the created label returns nothing and getting all labels returns nothing | No | Invariant | If a labeled conversation has its label deleted, the conversation should remain unchanged |
| R4 | C-8, S-10, O-8: "Nothing should be different. In both scenarios the end state should be the same." | The order in which labels are added as children to a parent label will not matter | **Given** at least 3 existing labels, **when** one is chosen as the parent and all the others are added as its children in different orders, **then** the outcome is the same regardless of order (one parent label, every other label as its child) | No | Metamorphic | Changing order of how multiple labels are added as children should not change output |
| R5 | C-10, S-12, O-10: "I could check the correct counts match" | Getting all conversations with a label will return the correct number of conversations with that label | **Given** x conversations share the same label, **when** all conversations with that label are requested, **then** exactly x conversations are returned | No | Invariant | Listing conversations by a label returns exactly the conversations assigned that label, regardless of how many other conversations are unlabeled, carry a different label, or had the label assigned twice |

Properties written or suggested by opencode or another AI tool: R5 (written by Claude Code)

Test File: `packages/core/test/label.property.test.ts`

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
NA; All requirements can be built as written. They are all feasible, have no conflicts and can be written as a check.