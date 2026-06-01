# Deadcode-removal scan

Identifies dead source files, unused exports, stale lint-disable directives, and test-only helpers (helpers whose only consumer is the colocated `.test.mts`). Reports candidates; the active deletion loop lives in any of the existing refactor skills the user prefers — this scan is read-only.

## Mission

Surface four shapes of dead code:

1. **Whole dead files** — source files with no importers anywhere (excluding their own test). Examples this scan caught in past sessions: `rich-progress.mts`, `bordered-input.mts`, `result-assertions.mts` (entire test-helper modules), `build-pipeline.mts`, `extraction-cache.mts`.
2. **Test-only helpers** — exports whose ONLY non-self consumer is the colocated `<file>.test.mts`. The helper exists for the test; the test exists for the helper; nothing real calls either. Per the fleet rule discussion: _exports exist for tests_ — but if NOTHING in `src/` reaches the helper, both should be deleted together.
3. **Stale lint-disable directives** — `// eslint-disable-next-line <rule>` or `// oxlint-disable-next-line <rule>` comments where the rule no longer fires on the line below (rule was relaxed, the offending construct was rewritten, etc.). Detected via `oxlint --report-unused-disable-directives`.
4. **Dead string-literal constants** — `const FOO = '...'` declarations with zero readers, including the declaring file. Often a leftover from a colocation pass that dropped `export` from a now-unused symbol.

## Inputs

- `git ls-files` — to enumerate tracked source + test files.
- `pnpm exec oxlint --config .config/oxlintrc.json --report-unused-disable-directives .` — canonical detector for shape (3). Treat oxlint's emit as authoritative.
- `tsc --noEmit` with `noUnusedLocals` — surfaces shape (4) (constants/types with no readers including self).

## Skip when

- The repo's `package.json` declares it as a published library (e.g. `socket-lib`, `socket-registry`, `socket-sdk-js`) AND the candidate symbol IS in the public `exports` map. Published API surface is deliberately wide; "no internal consumer" doesn't mean "no external consumer."
- The candidate is fleet-canonical (cascaded from `socket-wheelhouse/template/`). Edit the wheelhouse copy, not the downstream. Compare with `md5sum` to confirm.

## CRITICAL: do NOT do this

🚨 **Never drop the `export` keyword on a top-level function** to make it "file-private." The fleet rule `socket/export-top-level-functions` REQUIRES `export` on every top-level helper, with companion rule `socket/sort-source-methods` enforcing visibility-group ordering.

**Why:** _Exports exist for tests._ The colocated `.test.mts` imports internal helpers directly and asserts on them — that's the testability contract. Dropping `export` breaks the test's import. Past incident: a "colocate unused exports" sweep across 52 files in `packages/cli/src` triggered 141 lint violations and had to be reverted in `cdbbcf2f7`. Memory entry: `feedback-export-top-level-functions.md`.

**Correct surgical moves for a "test-only helper":**

- Delete the helper AND its test together (shape 2 above). The test wasn't covering real behavior.
- Or: keep the helper exported and accept the wide surface; the export is the cost of testability.

**Never:**

- Drop `export` to "shrink the public API surface."
- Convert an exported function to `function name(...)` (file-scope private) without also deleting it entirely.

## Method

### Shape 1: whole dead files

For each `src/**/*.mts` (excluding `.test.mts`, entry-point binaries like `npm-cli.mts`, barrel `index.mts`):

1. Has a colocated `.test.mts` or `test/unit/<...>.test.mts`? If not, skip this shape (handled by shape 2).
2. `git grep` for the basename in `src/`, `scripts/`, sibling packages (excluding `dist/`, `build/`, `coverage/`, the file itself, and the colocated test). Match both `from '.../<name>(.mts|.mjs|.ts|.js)?'` and bare references through barrel re-exports.
3. If zero non-test importers, candidate for shape-1 deletion.

### Shape 2: test-only helpers

For each exported name in `src/<file>.mts`:

1. Check whether the colocated `.test.mts` references it.
2. Check whether ANY other src file (or scripts/, sibling packages) references it.
3. If colocated test references it AND no other source references it → test-only helper. The pair (helper + test block) is dead code.

### Shape 3: stale lint-disable directives

```bash
pnpm exec oxlint --config .config/oxlintrc.json --report-unused-disable-directives . > /tmp/oxlint-disable.out 2>&1
grep -c "Unused (oxlint|eslint)-disable" /tmp/oxlint-disable.out
```

For each match: the directive line should be deleted. Common stale patterns:

- `// eslint-disable-next-line no-await-in-loop` — oxlint doesn't know this rule, so the disable is unused.
- `// eslint-disable-next-line n/no-process-exit` — same.
- `// oxlint-disable-next-line socket/prefer-cached-for-loop` — rule was relaxed for destructuring patterns; the disable is now dead noise.
- `/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable */` at line 1 of a file pointing at a block-disable on line 2 — when line 2 gets removed in an earlier strip, this one becomes orphaned.

### Shape 4: dead constants

Run `tsc --noEmit` (with `noUnusedLocals` enabled in tsconfig). Each `TS6133: 'X' is declared but its value is never read` finding is a dead constant/type/function — usually surfaced after a strip of stale disables removed the last consumer. Delete entirely.

## Output shape

```
### Deadcode Removal

**Shape 1: whole-file deletions** (N candidates)
- `packages/cli/src/util/terminal/rich-progress.mts` (333 LOC + colocated test 544 LOC)
  Reason: zero non-test importers. The test exists only to cover the helper.
  Action: delete both the src file and its test together.

**Shape 2: test-only helpers** (N candidates)
- `packages/cli/src/util/foo.mts:formatBar`
  Test consumer: `packages/cli/test/unit/util/foo.test.mts`
  Other consumers: none.
  Action: delete the helper AND drop the matching test block — don't preserve the test alone.

**Shape 3: stale lint-disable directives** (N occurrences)
- 65× `// eslint-disable-next-line no-await-in-loop`
- 30× `// eslint-disable-next-line n/no-process-exit`
- 65× `// oxlint-disable-next-line socket/prefer-cached-for-loop`
  Action: strip the directive line. Re-run oxlint to confirm zero new violations.

**Shape 4: dead constants surfaced by tsc** (N candidates)
- `packages/cli/src/foo.mts:42  SOMETHING_CONST`
- ...

Total: shape-1 LOC × N + shape-2 LOC × N + N stale directives + N dead constants
```

## Verification BEFORE acting

Before deleting ANY candidate, run both checks:

1. `tsc --noEmit -p packages/<pkg>/tsconfig.json` — must pass after the proposed delete.
2. `pnpm exec oxlint --config .config/oxlintrc.json .` — must report zero violations after the proposed delete.

If lint surfaces new `socket/export-top-level-functions` violations after a colocate-style change, **revert the change immediately**. Don't try to "fix" the lint by changing function order or adding disable comments — the rule wants the `export` keyword.

## When to escalate

- Shape-1 candidates totaling >500 LOC: high-confidence cleanup, hand off to a refactor pass.
- Shape-3 with >100 stale directives: indicates a recent rule-tightening cycle; consider opening a PR with just the strip.
- If `socket/export-top-level-functions` violations exceed 5 in a single file, the file is probably mid-refactor — pause the scan on that file and surface as a Medium finding for the author to resolve before another sweep.

## Cross-references

- `feedback-export-top-level-functions.md` — memory entry capturing the rule's intent and the past colocate incident.
- `socket/export-top-level-functions` — fleet oxlint rule in `template/.config/fleet/oxlint-plugin/`.
- `socket/sort-source-methods` — companion rule for visibility-group ordering.
- `feedback_repo_hygiene.md` — broader hygiene guidance ("No doc litter, pin deps, etc.").
