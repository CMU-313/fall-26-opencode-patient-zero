# Traceability: Jarrett Huang (jarretth)

**Target feature:** Adding labels to organize conversations, packages/core/src/label.ts

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4? | Property (kind) | Test | Mutant(s) it kills |
|---|---|---|---|---|---|---|---|
| R1 | C-4, O-4: "The child label should not change at all (naming, modifications)" | Adding a parent label to an existing label will not change that existing label's name | **Given** an existing label A, **when** label A is added as a child to another label B, **then** label A keeps its original name | No | Invariant | Label's name should not change after being added as a child | H1 |
| R2 | C-4, O-4: "the conversations with the child label shouldn't change" | When adding a label A as a child to another label B, any conversations under label A will remain unchanged and not have extra labels appended to them | **Given** an existing label A with conversations tagged to it, **when** label A is added as a child to another label B, **then** conversations with label A remain unchanged and label B is not added to those conversations | No | Invariant | Labeled conversations should not change or have more/less labels if its label is added as a children | H1 |
| R3 | C-6, S-8, O-6: "Any conversations with the label will no longer have that label. The label entry itself would also be deleted." | Creating a label and then deleting it will remove that label from the database without affecting any of its conversations | **Given** there are no previously created labels, **when** a label is created and then deleted, **then** getting the created label returns nothing and getting all labels returns nothing | No | Round Trip | Creating a label and then deleting it removes that label from the database without affecting any of its converstaions | H3 |
| R4 | C-8, S-10, O-8: "Nothing should be different. In both scenarios the end state should be the same." | The order in which labels are added as children to a parent label will not matter | **Given** at least 3 existing labels, **when** one is chosen as the parent and all the others are added as its children in different orders, **then** the outcome is the same regardless of order (one parent label, every other label as its child) | No | Metamorphic | Changing order of how multiple labels are added as children should not change output | H4 |
| R5 | C-10, S-12, O-10: "I could check the correct counts match" | Getting all conversations with a label will return the correct number of conversations with that label | **Given** x conversations share the same label, **when** all conversations with that label are requested, **then** exactly x conversations are returned | No | Invariant | Listing conversations by a label returns exactly the conversations assigned that label, regardless of how many other conversations are unlabeled, carry a different label, or had the label assigned twice | H5 |

Properties written or suggested by opencode or another AI tool: R5 (suggested by Claude Code), R1-5 fast check tests in the test file were written by Claude Code

Test File: `packages/core/test/label.property.test.ts`

## Requirement changes

| ID | Original requirement (P3) | Revised requirement | Why it changed |
|---|---|---|---|
NA; All requirements can be built as written. They are all feasible, have no conflicts and can be written as a check.

## Mutants

| ID | Requirement Targeted | Change | Predicted Killer | Actual Result |
|---|---|---|---|---|
| H1 | R1 | label.ts: Adding a label as a child to another label will change its name to lowercase. | Label's name should not change after being added as a child (R1) | Killed: Test cases string comparison is case sensitive, in this comparing `"Work`" with `"work`" caught the mutant. |
| H2 | R2 | label.ts: When adding a label A as a child to label B, conversations with label B will have label A added to them. | Labeled conversations should not change or have more/less labels if its label is added as a children (R2) | Survived: No conversations are ever tagged with label B, so the test never checks if label B's conversations are unchanged. |
| H3 | R3 | label.ts: Deleting a label with children will delete the children but not the label itself. | Creating a label and then deleting it removes that label from the database without affecting any of its conversations (R3) | Killed: Even though the children were deleted, the test cases check if returning all labels is empty. Since the label itself wasn't deleted, returning all labels returned a single label, catching the mutant. |
| H4 | R4 | label.ts: When adding a label as a child, only the first label added as a child is actually attached and later labels added are left in unattached. | Changing order of how multiple labels are added as children should not change output (R4) | Killed: The test cases check the number of children the parent label has. In this case, this is always one so the mutant is caught. |
| H5 | R5 | label.ts: Assigning a label twice crashes instead of doing nothing. | Listing conversations by a label returns exactly the conversations assigned that label, regardless of how many other conversations are unlabeled, carry a different label, or had the label assigned twice (R5) | Killed: The second assign crashed on UNIQUE constraint failed for the label IDs. |

## Stryker comparison
  
**Mutation score:** 59.46% (111 mutants: 64 killed, 2 timed out, 45 survived)
**Report:** mutants/jarretth/mutation.html

### Which of your hand-written mutants did Stryker never generate? Why not?

- **H1:** Stryker does not add a new call such as `current.name.toLowerCase()` where there was none.
- **H2:** This mutant adds new insertions where there was none before, while Stryker only changes or deletes existing code. It never writes new behavior.
- **H4:** Similar to H2, this mutant adds an additional condition which isn't in the scope of Stryker
- **H5:** Stryker has no mutator that deletes one call from a method chain.

### Which Stryker survivors would you never have thought of? Are any of them bugs a real developer might plausibly write?

There were quite a few Stryker survivors that I would not have thought of. A few standouts include skipping duplicate name checking when creating labels, accepting invalid label names and updating a label with only a name moves it to the top level of its nested hierarchy. These are all real a bugs a developer could write because they involve missing a condition check or calling a wrong function. For example Stryker will sometimes replace toLowerCase() to toUpperCase().

### What does each approach find that the other doesn't?

When hand creating my mutants, I thought of them from a logical implementation perspective. These mutants were all plausible if a developer misinterpreted or misread a design doc's specifications. While I kept all of my changes simple, such as adding or deleting a condition, Stryker's approach focused on making very slight changes to existing conditions or code. These changes were a lot more detailed and plausible if a developer made typoes during the development process.  
I can see the value in both of these approaches. My approach finds bugs in logic while Stryker finds bugs in code implementation, such as loop guards or off by one errors.
