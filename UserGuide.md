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

---

## session_label Table and session slash command (Cynthia, #20)

### Overview

This feature adds the database link between sessions and labels, and lets you search for sessions by label from the session picker. It builds on the label table (#16), the `Label` service (#14), and label assignment (#15) described above.

- **`session_label` table:** a junction table between `session` and `label`. Each row has `session_id`, `label_id`, `time_created`, and `time_updated`. `(session_id, label_id)` is the primary key, so a session can have any number of labels but each label only once. Both foreign keys use `ON DELETE CASCADE`, so deleting a session or a label removes its assignments. The `session_label_label_idx` index supports looking up sessions by label. The table is defined as `SessionLabelTable` in `packages/core/src/label/sql.ts` and created by the `20260927044105_session_labels` migration.
- **`label:` search in the session picker:** the `/sessions` picker (also `/resume` and `/continue`) accepts `label:<path>` alongside normal title words. The placeholder now reads `Search, or label:<path>`.
- **`/sessions <text>` from the prompt:** typing `/sessions label:Coursework` (or `/resume ...`, `/continue ...`) and pressing Enter opens the picker with that text already filled in, instead of sending it to the model.
- **HTTP API:** `GET /session` accepts a new optional `label` query parameter, e.g. `GET /session?roots=true&label=Coursework/Databases`. It can be combined with `search`.
- **Service:** `Label.resolvePath(path)` in `packages/core/src/label.ts` turns a label path into the IDs of every matching label plus all labels nested under them. `Session.list({ label })` in `packages/opencode/src/session/session.ts` uses it to filter sessions.

Label path rules:

- Segments are separated by `/` and matched case-insensitively. Spaces around segments are trimmed, and empty segments (`Coursework//Databases`, a leading or trailing `/`) are ignored.
- A path can start at any depth. `Databases` matches every label named `Databases`; `Coursework/Databases` only matches the one directly under `Coursework`.
- Nested labels are included. `label:Coursework` also finds sessions labeled `Coursework/Databases`, `Coursework/Databases/SQL`, and so on.
- A session that has several matching labels is listed once.
- A path that matches no label returns an empty list. It does not fall back to showing all sessions.

### How to use

1. Run `bun install`, then `bun dev` from the repo root to start opencode.
2. Assign labels to some sessions with `/label` (see "Assign Labels to Sessions" above).
3. Search by label in either of two ways:
   - Type `/sessions label:Coursework` in the prompt and press Enter. The picker opens already filtered.
   - Type `/sessions`, press Enter, then type `label:Coursework` in the picker's search box.
4. Select a result to open that session, as before.

Search examples:

| Search text | Shows |
| --- | --- |
| `label:Coursework` | Sessions labeled `Coursework` or any label nested under it |
| `label:Coursework/Databases` | Sessions labeled `Coursework/Databases` or anything under it |
| `exam label:Coursework` | Sessions under `Coursework` whose title contains `exam` |
| `label:"Machine Learning/Week 1"` | Quote paths that contain spaces |
| `LABEL:coursework` | `label:` and the path are both case-insensitive |

Things to know:

- Only one `label:` filter is read from the search text. Text such as `relabel:x` is treated as ordinary title text, and `label:` with no path is ignored.
- During a label search, the picker shows only what the server returns. The current session and pinned sessions are not added to the list unless they match.
- `/sessions` typed with no text still just opens the picker. `/sessions <text>` only works at the start of the prompt in normal (not shell) mode, and a server-defined command with the same name takes priority.

### How to run the automated tests

From the repo root, in each package:

```bash
cd packages/core && bun test test/database-migration.test.ts test/label.test.ts
cd ../opencode && bun test test/server/session-list.test.ts test/server/httpapi-session.test.ts
cd ../tui && bun test test/component/dialog-session-list.test.ts
```

To run only the tests for this feature, filter by name:

```bash
cd packages/core && bun test test/database-migration.test.ts -t "session_label|session-label|assigns labels to sessions|nonexistent session or label"
cd packages/core && bun test test/label.test.ts -t resolvePath
cd packages/opencode && bun test test/server/session-list.test.ts test/server/httpapi-session.test.ts -t label
cd packages/tui && bun test test/component/dialog-session-list.test.ts -t "label|/sessions|selectSessionListResults"
```

Run `bun install` at the repo root first. Tests can't be run from the repo root itself.

### Automated test locations

Commits `c647eac` and `14615e2` added the implementation along with its first tests. Commits `dd6be08` and `145a596` added more tests on the `ccao2/label-search` branch. 

- [`packages/core/test/database-migration.test.ts`](packages/core/test/database-migration.test.ts) tests the `session_label` table against a real in-memory SQLite database.
  - `c647eac`: "assigns labels to sessions and removes assignments with either side" checks that deleting a label or a session removes only its own assignments.
  - `dd6be08`: checks that the migration creates the table and `session_label_label_idx`. It checks the columns, composite primary key, both `CASCADE` foreign keys, and the index column. It also checks that a duplicate `(session_id, label_id)` pair is rejected while a different label on the same session is accepted, that a nonexistent session or label is rejected, and that rows without timestamps are rejected.
- [`packages/core/test/label.test.ts`](packages/core/test/label.test.ts), `resolvePath` block, tests path resolution in the `Label` service.
  - `14615e2`: descendants are included, matching ignores case and spaces, paths can start at any depth, duplicate names under different parents all match, and unknown or empty paths return nothing.
  - `145a596`: repeated, leading, and trailing `/` are ignored, and a path whose parent doesn't match (e.g. `Coursework/Notes` when `Notes` is under `Personal`) does not match.
- [`packages/opencode/test/server/session-list.test.ts`](packages/opencode/test/server/session-list.test.ts) tests `Session.list` with real sessions and labels.
  - `14615e2`: "filters by label path, including nested labels" covers parent paths, nested paths, combining `label` with `search`, and unknown labels.
  - `145a596`: "lists a multi-labeled session once even when several of its labels match".
- [`packages/opencode/test/server/httpapi-session.test.ts`](packages/opencode/test/server/httpapi-session.test.ts), added in `145a596`, sends real HTTP requests to `GET /session`. It checks that leaving out `label` changes nothing, that parent and nested paths filter correctly, and that an unknown path returns `[]`. It also checks that a URL-encoded path with spaces, mixed case, and a `/` (`machine learning/WEEK 1`) is decoded and resolved.
- [`packages/tui/test/component/dialog-session-list.test.ts`](packages/tui/test/component/dialog-session-list.test.ts) tests the TUI parsing and selection logic.
  - `14615e2`: `label:` and title words are split into separate `label` and `search` query fields. Quoted, unfinished (`LABEL:"Machine Lea`), and empty `label:` filters are parsed, and `relabel:x` is not treated as a filter. `/sessions`, `/resume`, and `/continue` with text are recognized, while `/sessions` alone, other commands, and a command in the middle of text are not.
  - `145a596`: the `selectSessionListResults` block checks that a label search uses only server results. It never falls back to browse or synced sessions and never re-adds the current or pinned sessions, even when the result is empty. It also checks that the normal fallback returns when the filter is cleared, that title filtering still applies to label results, and that deleted sessions are always hidden.

### Why the tests are sufficient

The tests cover each layer the feature touches, using real code instead of mocks:

- **Database:** the table structure is checked directly, and SQLite is used to prove that duplicates, missing references, and missing timestamps are rejected and that deletes cascade.
- **Path matching:** every path rule listed above has a test, including the edge cases (case and spaces, extra `/`, duplicate names under different parents, a parent that doesn't match, unknown and empty paths).
- **Session listing and HTTP:** the tests check that the `label` parameter actually filters real sessions, that nested labels are included, that each session is listed only once, that it combines with `search`, that an unknown label gives `[]` instead of every session, and that encoded paths work over HTTP.
- **TUI:** parsing of the search text and the slash command is tested with valid, quoted, unfinished, and invalid input. The selection tests protect the main UI rule: a label search must never show sessions the server didn't return.

