# User Guide

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
