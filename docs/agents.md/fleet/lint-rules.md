# Lint rules: errors over warnings, fixable over reporting

The CLAUDE.md `### Lint rules` section is the headline. This file is the full rationale and the cascade behavior.

## Rationale

Fleet lint rules are guardrails for AI-generated code. Make them strict:

- **Errors, not warnings.** A warning is silently ignored; an error blocks the commit. Severity `"warn"` belongs to user-facing tools (browser dev consoles, ad-hoc scripts), not the fleet's CI gate. Default to `"error"` for new rules; bump existing `"warn"` entries to `"error"` when you touch them.
- **Fixable when possible.** Every new rule that _can_ express a deterministic rewrite _should_ ship an autofix. The `fixable: 'code'` meta flag plus a `fix(fixer) => ...` in `context.report` lets `pnpm exec oxlint --fix` clean up the violation. Reporting-only rules are fine when the fix requires human judgment (e.g., picking between `httpJson` vs `httpText` to replace `fetch()`); say so explicitly in the rule docstring.
- **Skill or hook ≠ no rule.** If a behavior already lives as a skill (the canonical write-up) or a hook (PreToolUse blocking), still encode the lint rule on top. Defense in depth. The skill is documentation, the hook is edit-time enforcement, the lint rule is commit-time enforcement.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. The fleet socket-\* oxlint plugin lives in `template/base/.config/fleet/oxlint-plugin/`; new fleet rules land there. Wire via `.oxlintrc.json` `jsPlugins` and the `socket/` namespace.

## Host-test deps: the `fleet.hostTestDeps` exemption

The "no foreign linter/formatter packages" rule has one carve-out. A package whose code ADAPTS TO a foreign tool (converting plugins into ESLint rules, say, or emitting Prettier-compatible output) needs that tool installed to integration-test against. The package declares the exemption explicitly:

```json
{
  "fleet": { "hostTestDeps": ["eslint"] }
}
```

The allowance holds only while ALL of:

1. the dep name is listed in `fleet.hostTestDeps` (exact match);
2. the dep lives only in `devDependencies` / `peerDependencies`. A runtime `dependencies` / `optionalDependencies` entry ships the tool to consumers and stays blocked;
3. no package script invokes the tool's binary (including via `npx` / `pnpm exec` indirection). Running it makes it a lint/format gate, which is exactly what the rule forbids. Script ARGUMENTS that merely mention the tool (`vitest run to-eslint.test.ts`) don't void the allowance.

Foreign **config files stay blocked unconditionally**: host APIs used in tests (ESLint `RuleTester` / `Linter`, Babel programmatic transforms) need no config file.

The contract + audit logic live in ONE place, `.claude/hooks/fleet/_shared/foreign-linters.mts`, consumed by both the edit-time hook (`no-other-linters-guard`) and the committed-state gate (`scripts/fleet/check/linters-are-oxlint-oxfmt-only.mts`).

**Why:** adapter packages (author a plugin once, ship it to many hosts) were forced to choose between mock-only integration coverage and a blanket guard bypass; an explicit, audited manifest field keeps the gate strict while making the legitimate case first-class.

## Optional `| undefined` vs typescript/no-duplicate-type-constituents

The fleet writes every optional as `x?: T | undefined`, property and parameter, enforced by `socket/optional-explicit-undefined` (autofix appends `| undefined`). The type-aware `typescript/no-duplicate-type-constituents` sees the PARAM form as a duplicate, since an optional parameter's checker type already carries an implicit `undefined`: it reports "Explicit undefined is unnecessary on an optional parameter", and its autofix strips the union member, leaving the flanking whitespace behind. With both rules live the fix loop ping-pongs: socket appends, tsgolint strips with residue, +2 spaces per pass (`body?: string        ,` after the runner's 4 passes, the decmpfs/socket-sdk-js mangling).

The fleet sides with the socket rule: the explicit `| undefined` is the `exactOptionalPropertyTypes` pairing convention, uniform across properties and params, not redundancy. So the canonical config keeps `socket/optional-explicit-undefined` at `"error"` and configures the typescript rule with `{ "ignoreUnions": true }` - it still catches duplicate intersection constituents, and its union leg, the only surface that can fight the convention, is off. Never resolve the conflict per-line: `oxlint-disable` comments don't reach tsgolint (it honors only `eslint-disable` markers), and per-site silences would need one comment per optional in the codebase.

## Cascade

When introducing a new rule fleet-wide, expect it to surface dozens of pre-existing violations. That's the rule earning its keep, not noise. Surface the cleanup as a separate task rather than auto-fixing in the same PR.

## Repo-owned overrides: the sanctioned surface

`.config/fleet/oxlintrc.json` is FLEET-MANAGED - cascaded byte-identical, so any hand edit (staging a rule off, adding an overrides block) is reverted by the next refresh. Never park repo state there. The two repo-owned surfaces that survive a refresh:

1. **A per-repo `oxlint.config.mts` under `.config/repo/`** - the composable factory call. It imports `config()` from `.config/fleet/oxlint.config.mts` and augments in JS: `rules` merge over the fleet rules, `overrides` blocks append after the fleet blocks, `jsPlugins` and `ignorePatterns` extend the fleet lists. This is where a burn-down staging lives - e.g. a new `socket/*` rule that surfaced a pre-existing debt pile gets `'socket/<rule>': 'off'` (or a scoped `overrides` block) HERE, with a comment naming the campaign, and the entry is deleted when the count reaches zero. socket-lib's staging of `socket/no-required-in-options-bag` off for `**/src/**` is the exemplar.
2. **The `ignorePatterns` tail after the fleet-canonical end sentinel**: inside the fleet oxlintrc's `ignorePatterns` array, entries after the end sentinel (`FLEET_CANONICAL_END_SENTINEL` in `scripts/fleet/_shared/fleet-canonical-splice.mts`) are repo-owned; the cascade splices only the sentinel-fenced region and preserves the tail. Ignore-shaped repo state, a vendored tree or a generated dir, goes there when the JS factory's `ignorePatterns` option isn't already carrying it. This doc never spells the raw token: only the designated segment files may carry it in the bundle payload, enforced by the stray-carrier class check, because pre-path-gate placement machinery splices any file containing it.

Rule of thumb: rules and overrides → the repo factory config; ignores → either surface. Anything typed INSIDE the fleet-canonical region is a revert waiting to happen.

## Disable comments: per-call-site, never identical-stacked

`oxlint-disable-next-line <rule> -- <reason>` is correct when a single call site has a genuine, code-local justification that wouldn't apply to siblings. Stacking the same comment on adjacent lines is the failure mode.

<details>
<summary><b>Detail</b> - Wrong, Right (helper pattern), Right (sentinel-constant pattern), Why this matters, When per-call-site IS correct</summary>

**Wrong**: three byte-identical disables on consecutive lines:

```ts
// oxlint-disable-next-line socket/prefer-exists-sync -- isDir is the unit under test.
expect(await isDir(dir)).toBe(true)
// oxlint-disable-next-line socket/prefer-exists-sync -- isDir is the unit under test.
expect(await isDir(file)).toBe(false)
// oxlint-disable-next-line socket/prefer-exists-sync -- isDir is the unit under test.
expect(await isDir(other)).toBe(false)
```

**Right (helper pattern)**: lift the rule-violating call behind a one-line helper. The helper's declaration carries the disable once; the test reads clean:

```ts
it('isDir returns true for directories', async () => {
  // oxlint-disable-next-line socket/prefer-exists-sync -- isDir is the unit under test.
  const callIsDir = (p: string) => isDir(p)
  expect(await callIsDir(dir)).toBe(true)
  expect(await callIsDir(file)).toBe(false)
  expect(await callIsDir(other)).toBe(false)
})
```

**Right (sentinel-constant pattern)**: when the violation is a literal value rather than a call (e.g., GraphQL spec mandates `null` for unresolved nodes), name the literal at module scope:

```ts
// oxlint-disable-next-line socket/prefer-undefined-over-null -- GraphQL spec returns null for unresolved nodes.
const GRAPHQL_NULL = null

// Then in tests:
JSONStringify({
  data: { repository: { tagRef: GRAPHQL_NULL, branchRef: GRAPHQL_NULL } },
})
```

**Why this matters:** stacked identical disables are visual noise that obscures the real signal (per-line disables exist to highlight _exceptional_ code). When the disable repeats verbatim, the exception isn't per-line. It's per-pattern, and the pattern deserves its own name.

**When per-call-site IS correct:** the reasons differ, OR the disables sit on lines that aren't adjacent. Two disables 20 lines apart in the same file with the same rule + same reason is fine; what's banned is the consecutive stack on adjacent lines.

</details>

## Zero scope is not a pass

`pnpm run lint` and `pnpm run fix` default to the MODIFIED scope: they lint the
files git already sees as changed. On a clean tree that scope is empty, so the
run checks nothing.

An empty scope prints the verdict `0 files checked — this is NOT a pass` on
stderr and withholds `Lint passed`. It covers two shapes: the git-diff scope
(`--modified` / `--staged`) resolving to no files at all, and any scope whose
files all filter out as non-lintable (wrong extension, missing on disk,
format-ignored cascade mirror), explicit positional file arguments included.

The verdict goes through `logger.warn`, so `--quiet` does not swallow it:
`--quiet` suppresses progress, and this is the result.

The exit code stays 0. `.git-hooks/fleet/pre-commit` runs `lint --staged`, the
pre-push chain and `check --all` run the default scope, and the worktree land
re-assert passes explicit file arguments - each legitimately sees a set with
nothing lintable in it (a docs-only commit), and a non-zero exit would block
them. `--all` never resolves to a zero scope, so the whole-tree gate needs no
exit-code change to stay honest.

**Only `--all` produces a whole-tree verdict.** Reading a scoped green as "the
repo is clean" is how a real backlog stays invisible: a clean-tree run reported
success while 15 lint errors and a type error sat in the tree. Before a push,
run `node scripts/fleet/lint.mts --all`.

## Enforcement

- `.claude/hooks/fleet/no-direct-linter-guard/` - blocks a direct
  `prettier` / `eslint` / `cargo fmt` invocation in a fleet repo.
- `.claude/hooks/fleet/no-file-oxlint-disable-guard/` - blocks a file-scope
  `oxlint-disable`, forcing the per-call-site form.
- `.claude/hooks/fleet/no-other-linters-guard/` - blocks adding a foreign
  linter/formatter package or config.
- `.claude/hooks/fleet/oxlint-plugin-load-nudge/` - re-verifies the `socket/`
  plugin still loads after an edit under `.config/fleet/oxlint-plugin/**`.
- `scripts/fleet/lint.mts` - the scoped/`--all` lint runner; owns the
  zero-scope verdict described above.
