# Red team: Anjali Dadlani (anjalid), T3A Party

**Feature:** Permission rules (`evaluate()` and the permission service).
**Target PR:** https://github.com/CMU-313/fall-26-opencode-t3a-party/pull/27
**Commit studied:** `83ef6d4e5b90e94c27522772a5bbb0c465422cb2`
**Properties attacked:** `packages/opencode/test/permission/permission.property.test.ts`

To run one, from the repo root at that commit:

```bash
git apply mutants/dylany/redteam/RT1.patch   # copy the patch over first
cd packages/opencode && bun test test/permission/permission.property.test.ts
cd ../.. && git checkout -- packages
```

| ID | Requirement | Change | Expected to slip past |
| --- | --- | --- | --- |
| RT1 | R1 | `DeniedError.ruleset` filters rules with `pattern` instead of `request.permission`, so the error comes back with an empty ruleset. | All four properties: they call `evaluate()` directly and never look at the `DeniedError`. |
| RT2 | R3 | `Wildcard.match` turns a trailing `" *"` into `".*"` instead of `"( .*)?"`, so `rm *` also matches `rmdir build`. | R3 and R6: every generated command is `rm <something>` or one of five fixed commands, so no command shares a prefix with a pattern without the space. |
| RT3 | R5 | `evaluate()` drops the `rule.permission` check, so the last rule wins even if it is for a different permission. | All four properties: the generator always uses permission `"bash"`, so a rule for another permission never appears. |

Checked by running the four properties 8 times each against every mutant: all 4 pass every time.
