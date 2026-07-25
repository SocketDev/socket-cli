# fixes-need-tests-nudge

**PreToolUse (Bash) — nudge, never blocks.**

On a `git commit`, reminds when the STAGED change set touches authored source
but carries no test-file change. A code fix ships the unit test that covers the
fixed behavior. If a layer isn't unit-testable, extract the pure logic and test
that; otherwise state why in the PR.

It is the commit-time enforcer for the "Delegated fix-work standards" rule in
[`agent-delegation.md`](../../../../docs/agents.md/fleet/agent-delegation.md).

## What counts as source

Authored source is a JS/TS file (`.ts` / `.mts` / `.cts` / `.tsx` / `.js` /
`.mjs` / `.cjs` / `.jsx`) that is **not**:

- a test file — `*.test.*` / `*.spec.*` / `*.vitest.*`, or anything under a
  `test/`, `tests/`, or `__tests__/` directory;
- generated / mechanical — a `build/**` or `dist/**` tree, the `_dispatch/`
  bundle, a `*.min.*` artifact, a `*.generated.*` output, `bundle.cjs`, or
  `index.cjs`;
- a build/tool config (`*.config.*`) or a bare type declaration (`*.d.ts`).

Docs (`.md`), data (`.json` / `.yaml`), and every non-code file are excluded by
the extension test, so a **docs/config/chore-only commit yields zero source
files and stays silent**.

## When it fires

The change set includes at least one authored-source file AND includes no
test-file change. A commit that adds or edits a test alongside the source
change passes silently.

## Fix

Ship the unit test with the change. If the fixed layer isn't unit-testable,
extract the pure logic into a testable function and cover that; otherwise state
in the PR why the change is test-free.

Reminder-only. There is no bypass phrase because it never blocks.

## Trigger

`git commit` (via the shared `isGitCommit` parse). The change set is
`git diff --cached --name-only`, so `&&` chains and command quoting don't
matter. A cascade (`FLEET_SYNC=1`) is exempt; the hook fails open on any git
error.
