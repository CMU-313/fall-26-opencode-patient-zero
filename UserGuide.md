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

## HTTP Endpoints for Label Service (Jarrett, #23)

HTTP endpoints to call Label Service
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