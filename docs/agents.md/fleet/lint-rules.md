# Lint rules: errors over warnings, fixable over reporting

The CLAUDE.md `### Lint rules` section is the headline. This file is the full rationale and the cascade behavior.

## Rationale

Fleet lint rules are guardrails for AI-generated code. Make them strict:

- **Errors, not warnings.** A warning is silently ignored; an error blocks the commit. Severity `"warn"` belongs to user-facing tools (browser dev consoles, ad-hoc scripts), not the fleet's CI gate. Default to `"error"` for new rules; bump existing `"warn"` entries to `"error"` when you touch them.
- **Fixable when possible.** Every new rule that _can_ express a deterministic rewrite _should_ ship an autofix. The `fixable: 'code'` meta flag plus a `fix(fixer) => ...` in `context.report` lets `pnpm exec oxlint --fix` clean up the violation. Reporting-only rules are fine when the fix requires human judgment (e.g., picking between `httpJson` vs `httpText` to replace `fetch()`); say so explicitly in the rule docstring.
- **Skill or hook ≠ no rule.** If a behavior already lives as a skill (the canonical write-up) or a hook (PreToolUse blocking), still encode the lint rule on top. Defense in depth. The skill is documentation, the hook is edit-time enforcement, the lint rule is commit-time enforcement.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. The fleet socket-\* oxlint plugin lives in `template/.config/oxlint-plugin/`; new fleet rules land there. Wire via `.oxlintrc.json` `jsPlugins` and the `socket/` namespace.

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

## Cascade

When introducing a new rule fleet-wide, expect it to surface dozens of pre-existing violations. That's the rule earning its keep, not noise. Surface the cleanup as a separate task rather than auto-fixing in the same PR.

## Disable comments: per-call-site, never identical-stacked

`oxlint-disable-next-line <rule> -- <reason>` is correct when a single call site has a genuine, code-local justification that wouldn't apply to siblings. Stacking the same comment on adjacent lines is the failure mode.

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
