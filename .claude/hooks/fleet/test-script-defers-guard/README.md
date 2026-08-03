# test-script-defers-guard

**Type:** PreToolUse guard (Edit/Write/MultiEdit) — BLOCKS (exit 2).

**Trigger:** an Edit/Write/MultiEdit to a `package.json` whose incoming
content adds a `test`/`test:*` script that invokes a raw test-runner binary
(`vitest`, `jest`, `mocha`, `ava`, `tap`, or a bare `node --test`) instead of
a `.mts` wrapper.

**Why:** the wrapper (`scripts/fleet/test.mts`) owns `--config` resolution,
scope detection, and the pre-commit single-worker setting. A raw runner call
bypasses all three, and a runner invoked against zero matching test files
silently reports a green pass instead of failing loud. CLAUDE.md "Tests are
vitest via…".

**Exempt:** the hook / lint-rule / git-hook tier's own package.json
(`.claude/hooks/**`, `.config/fleet/oxlint-plugin/**`, `.git-hooks/**`) —
its canonical form IS `node --test test/*.test.mts`.

**Fix the message gives:**
- Route through the fleet-canonical wrapper: `"test": "node scripts/fleet/test.mts"`
- Reference: `docs/agents.md/fleet/test-scripts-defer-to-mts.md`

**Bypass:** `Allow test-script-defers bypass` typed verbatim in a recent user
turn.

**Companion surfaces:**
- Check script `scripts/fleet/check/test-scripts-are-deferred.mts` — full-scan
  of every fleet `package.json` file; report-only by default, `--strict`
  fails on any violation.

**Fails open** on parse / payload errors (exit 0) — a guard bug must not
wedge every Edit call.
