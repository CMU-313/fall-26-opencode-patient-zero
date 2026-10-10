# User Guide

## Label Database Table (Brian, #16)

In this section we describe in detail the database table for labels which can be added to opencode chats; details about testing and constraints are also included.

## Architecture

The `labels` table is defined as follows:

- `id`: unique identifier
- `name`: label name, which is required
- `parent_id`: points to another label or is `NULL` for a root label.
- `time_created`: records creation time.
- `time_updated`: records the most recent update time.

The `label_parent_idx` index supports lookups of direct children. The `parent_id` foreign key prevents a row from pointing at a label that does not exist.

Use `parent_id: null` for a root label and an existing label ID for a child. Query rows by `parent_id` to recover direct children. This work provides the schema, migrations, indexes, and database constraints for label storage.

### Testing

Run from `packages/core`:

```bash
bun test test/database-migration.test.ts
bun typecheck
```

They cover:

- Schema creation, columns, indexes, and the self-referencing foreign key
- Root labels, multiple children, multiple roots, and three-level hierarchies
- Round-tripping names, parent IDs, and timestamps
- Missing-parent rejection
- Direct parent deletion cascading through descendants
- Existing label and session-label data surviving the integrity migration
- Duplicate IDs and `NULL` names at the database layer
- Case-insensitive duplicate root and sibling names rejected by SQLite
- Same names under different parents accepted
- Branching subtree deletion while preserving unrelated labels

### Automated test locations

- [`packages/core/test/database-migration.test.ts`](packages/core/test/database-migration.test.ts) verifies the SQLite migration and raw database constraints.
- [`packages/core/src/label/sql.ts`](packages/core/src/label/sql.ts) contains the Drizzle table definitions.
- [`packages/core/src/database/migration/20260924012642_labels.ts`](packages/core/src/database/migration/20260924012642_labels.ts) creates the original label table and parent index.
- [`packages/core/src/database/migration/20261009202659_label-integrity.ts`](packages/core/src/database/migration/20261009202659_label-integrity.ts) adds cascade deletion and database-enforced sibling-name uniqueness while preserving existing rows.

### Why the automated tests are sufficient

These tests are sufficient because this work is a database schema and migration, so correctness depends on both the declared constraints being present and SQLite enforcing them at runtime. The suite checks the metadata and then exercises the valid and invalid boundaries with a real database, including an upgrade from the previous schema that verifies existing data is preserved. This would catch a missing foreign key or unique index, an incorrect cascade boundary, a broken table rebuild, or a change that stores parent relationships or timestamps incorrectly.

---

## Label CRUD (Dylan, #14)

### Overview

Adds a `Label` service in `packages/core/src/label.ts` for creating, reading, updating, and deleting labels. Labels can be nested (e.g. `School/Math`), and the other label features (HTTP endpoints, `/label` command, search) are built on top of this service.

- `create({ name, parentID? })`: create a label, optionally under a parent
- `get(id)`: get one label
- `list({ parentID? })`: list all labels, top-level labels (`parentID: null`), or one label's children
- `update(id, { name?, parentID? })`: rename or move a label (`parentID: null` moves it to the top level)
- `remove(id)`: delete a label and all labels nested under it

Invalid operations return an error instead of failing silently:

- Label or parent doesn't exist, or was already deleted: `NotFoundError`
- Empty name or name over 64 characters: `InvalidNameError`
- Same name as another label under the same parent: `DuplicateNameError`
- Moving a label under itself or its own child: `CycleError`

### How to test

```bash
bun install
cd packages/core
bun test test/label.test.ts
```

All tests should pass with `0 fail`.

### Tests

Tests are in `packages/core/test/label.test.ts`. Each test uses a fresh in-memory database. They cover:

- **Create:** basic and nested labels, name trimming, invalid names, missing or empty-string parent, duplicate names
- **Read:** getting a missing label, listing all / top-level / child labels
- **Update:** renaming, moving, no-op updates, updating a missing or deleted label, cycles, duplicate names
- **Delete:** deleting a label, deleting its children, deleting a missing or already deleted label

These tests are sufficient because every operation has a passing case and every error case listed above has a test, including the two from our acceptance criteria (deleting a nonexistent label and editing a deleted label). The empty-string test was added after code review on #22 found that bug.

---

## HTTP Endpoints for Label Service (Jarrett, #23)

### Overview

Added 5 CRUD HTTP endpoints to call the Label Service (See above #14). 
- `GET /api/label:`	Lists all labels. Add ?parentID=root for top-level labels only, or ?parentID=<id> for one label’s children
- `GET /api/label/<id>:`	Gets one label with id
- `POST /api/label:`	Creates a label. Body: {"name": "...", "parentID": "<id>"}, where parentID is optional
- `PATCH /api/label/<id>:`	Renames or moves a label. Body: {"name": "..."} and/or {"parentID": "<id>"}; "parentID": null moves it to the top level
- `DELETE /api/label/<id>:`	Deletes the label and all nested labels under it; Returns the deleted ID(s)

### Tests

Run from root

Test cases were added in 3 different files:
1. HTTP endpoint tests
Tests the core functionality of the endpoints, making sure all CRUD operations are working and returning the correct HTTP response. Also includes some integration tests for testing consecutive operations.
cd packages/opencode && bun test test/server/httpapi-v2-label.test.ts

2. OpenAPI contract tests
Checks that the machine readable description of the API includes the new API routes (/api/label and /api/label/{labelID})
cd packages/opencode && bun test test/server/httpapi-public-openapi.test.ts

3. Schema tests
Tests for the labels schema in packages/schema
cd packages/schema && bun test test/contract-hygiene.test.ts

These tests are sufficient for ensuring that HTTP endpoints to call Label service works. Alongside adding unit tests for individual CRUD operations, integration tests for consecutive CRUD operations exist as well. The API routes and schema are also testing for further completeness.

---

## Assign Labels to Sessions (Tate, #15)

### Overview

Labels can now be attached to sessions. A session can have any number of labels, and the same label can be on many sessions. This is what makes the `label:` search in the session list return results.

- **TUI:** the `/label` command opens a picker for the current session. Selecting a label toggles it on or off, and typing a new name lets you create a label and assign it in one step.
- **HTTP API:**
  - `GET /api/session/:sessionID/label` lists a session's labels, sorted by name.
  - `PUT /api/session/:sessionID/label/:labelID` assigns a label.
  - `DELETE /api/session/:sessionID/label/:labelID` unassigns a label.
- **Service:** `Label.assign`, `Label.unassign`, and `Label.forSession` in `packages/core/src/label.ts`.

Edge cases:

- Assigning a label the session already has does nothing.
- Unassigning a label the session doesn't have does nothing.
- Assigning a label that doesn't exist (or was deleted) fails with a 404 `LabelNotFoundError`.
- Assigning to a session that doesn't exist fails with a 404 `SessionNotFoundError`.
- Deleting a label (or one of its parent labels) or deleting a session removes those assignments automatically.

### How to use and user test

1. Run `bun install`, then `bun dev` from the repo root to start opencode.
2. Send a message so you're in a session, then type `/label` and press Enter.
3. Type `Work`, then select **Create label "Work"**. It should show **✓ Assigned**.
4. Select `Work` again. The checkmark should go away. Select it once more to reassign it.
5. Press Esc, then type `/sessions label:Work`. Only sessions with the `Work` label should show up.
6. Unassign `Work` with `/label` and search again. The session should no longer appear.
7. Nested labels show as full paths like `Coursework/Databases`. Search them with `label:Coursework/Databases`, and use quotes if the path has spaces.

### How to run the automated tests

```bash
cd packages/core && bun test test/label.test.ts
cd ../opencode && bun test test/server/httpapi-session-label.test.ts test/server/session-list.test.ts
```

### Automated test locations

- [`packages/core/test/label.test.ts`](packages/core/test/label.test.ts): the `session assignment` block tests the service directly against a real in-memory database.
- [`packages/opencode/test/server/httpapi-session-label.test.ts`](packages/opencode/test/server/httpapi-session-label.test.ts) tests the three HTTP endpoints with real requests and a real session.
- [`packages/opencode/test/server/session-list.test.ts`](packages/opencode/test/server/session-list.test.ts): the "lists sessions after a label is assigned" test checks the full path from assigning a label to finding the session with `label:` search.

### Why the tests are sufficient

The acceptance criteria for #15 were that labels work end to end and that there's no weird logic around missing or deleted labels. The tests cover this at all three layers: the service, the HTTP API, and session search.

- Every operation (assign, unassign, list) has a passing test at both the service and HTTP level.
- Every edge case listed above has its own test, including the "weird logic" ones: assigning a deleted label, assigning to a missing session, assigning twice, and unassigning something that isn't assigned.
- Both cleanup paths are tested (deleting a label and deleting a session), so no leftover assignments point to things that are gone.
- The search test proves assignments actually change what users see, not just what's in the database.
