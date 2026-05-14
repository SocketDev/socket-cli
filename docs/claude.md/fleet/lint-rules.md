# Lint rules: errors over warnings, fixable over reporting

The CLAUDE.md `### Lint rules` section is the headline; this file is the full rationale and the cascade behavior.

## Rationale

Fleet lint rules are guardrails for AI-generated code. Make them strict:

- **Errors, not warnings.** A warning is silently ignored; an error blocks the commit. Severity `"warn"` belongs to user-facing tools (browser dev consoles, ad-hoc scripts), not the fleet's CI gate. Default to `"error"` for new rules; bump existing `"warn"` entries to `"error"` when you touch them.
- **Fixable when possible.** Every new rule that _can_ express a deterministic rewrite _should_ ship an autofix. The `fixable: 'code'` meta flag plus a `fix(fixer) => ...` in `context.report` lets `pnpm exec oxlint --fix` clean up the violation. Reporting-only rules are fine when the fix requires human judgment (e.g., picking between `httpJson` vs `httpText` to replace `fetch()`); say so explicitly in the rule docstring.
- **Skill or hook ≠ no rule.** If a behavior already lives as a skill (the canonical write-up) or a hook (PreToolUse blocking), still encode the lint rule on top — defense in depth. The skill is documentation, the hook is edit-time enforcement, the lint rule is commit-time enforcement.
- **Tooling: oxlint + oxfmt only.** No ESLint, no Prettier. The fleet socket-\* oxlint plugin lives in `template/.config/oxlint-plugin/`; new fleet rules land there. Wire via `.oxlintrc.json` `jsPlugins` and the `socket/` namespace.

## Cascade

When introducing a new rule fleet-wide, expect it to surface dozens of pre-existing violations. That's the rule earning its keep, not noise — surface the cleanup as a separate task rather than auto-fixing in the same PR.
