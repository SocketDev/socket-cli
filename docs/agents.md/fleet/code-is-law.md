# Code is law

The CLAUDE.md `### Code is law` section is the headline: docs alone don't enforce. A discipline the repo depends on holds only when an executable enforcer makes the wrong move fail (or at least nag) at the moment it happens. This file is the umbrella that ties the per-layer rules together. It does not replace them.

## The principle

Agent memory is per-session and unreliable. Prose is read when convenient. Neither enforces anything. A rule earns its keep only when it is **codified** into a script, hook, or lint rule that fires on violation. Every enforced discipline should be expressed across **all applicable** defense-in-depth layers, not only the cheapest one. The layers, and what each buys you:

- **Documented**: a skill (`.claude/skills/fleet/<gerund>/SKILL.md`, the canonical multi-step write-up) or a CLAUDE.md `🚨` line (the human-readable *why*). Necessary so a reader or agent knows the rule, but not sufficient. A documented rule with no enforcer is policy on paper.
- **Hook** (`.claude/hooks/fleet/<name>/`): edit-time and tool-time enforcement. A `-guard` (PreToolUse, exit 2) BLOCKS a dangerous action before it happens. A `-reminder` (Stop or PreToolUse, exit 0) NUDGES when you can't hard-block. One surface per concern, never both a guard and a reminder for the same thing.
- **Lint rule** (`socket/<rule>` in `template/.config/oxlint-plugin/`): commit-time and editor enforcement, for violations visible in source text or AST. Default `"error"` (never `"warn"`). Ship an autofix (`fixable: 'code'`) when the rewrite is deterministic.
- **Script** (`scripts/fleet/check/<name>.mts` wired into `check --all`): repo-wide structural or state invariants (drift, parity, file layout, cross-file consistency) that no single file's lint can catch. Also build-step automation for a "remember to run X" discipline. Make the flow run X itself or gate on its output, which beats a reminder when X is invokable.

The principle is itself enforced. `scripts/fleet/check/claude-md-rules-are-enforced.mts` (wired into `check --all`) fails the gate when a `🚨` rule in the CLAUDE.md fleet block or a `docs/agents.md/fleet/` page cites no resolving hook, lint rule, or script. That is the policy-on-paper state this whole rule forbids. A rule that genuinely can't be coded carries an inline `<!-- enforcement: CATEGORY reason -->` opt-out, where CATEGORY is one of `human-review`, `off-machine`, or `installer`.

## Pick the layers that fire where the violation happens

The goal is not "one layer is enough." It is to make the wrong move fail at every point it could happen. A code-shape rule wants a lint rule (CI plus editor), a CLAUDE.md line (the why), and, for AI-generated code, an edit-time hook. A build step wants automation plus a backstop reminder. Having one layer does not excuse the others. Choosing the surface per gap is the core decision the `codifying-disciplines` skill walks through.

## Each layer follows the coding rules

The enforcers are themselves fleet code and obey every fleet rule:

- **1 path, 1 reference.** An enforcer constructs a path once and references the value everywhere else. Never re-derive a path or a banned-pattern list in two enforcers.
- **DRY into `_shared/`.** When a hook and a check script (or two hooks) need the same detection logic (a parser, a regex set, an allowlist, a shell-command AST walk), lift it into a `.claude/skills/fleet/_shared/` lib (or `_shared/scripts/`) and import it. Copy-pasted detection drifts: one copy gets the fix, the other stays buggy, and a green gate hides the gap.
- **Tests are mandatory.** A codification without thorough tests (both arms, every branch, the bypass, pass-through, adversarial inputs) is not done. See the `codifying-disciplines` skill for the per-surface test matrix.
- **Standard code style.** `function` declarations, no `any`, `import type`, `getDefaultLogger()`, error messages that name What / Where / Saw-vs-wanted / Fix. The enforcer is not exempt from the rules it enforces.

## How this relates to the neighboring rules

- **`### Compound lessons into rules`** answers *when* to codify: when the same finding fires twice. It is the trigger.
- **`### Lint rules: errors over warnings`** answers *how* to build one specific layer (the lint rule) well.
- **`### Code is law`** (this rule) is the *umbrella*. Once you decide to codify (Compound lessons) you must cover all applicable layers, and each must be built to spec (1-path-1-ref, DRY, tests, style).
- **`/codifying-disciplines`** is the executor. It scans CLAUDE.md rules with no enforcer, repeated review feedback, build steps relying on memory, unchecked doc conventions, lock-step comments, and auto-memory entries. It ranks the gaps by blast radius and proposes the lowest-friction layer (or combination) per gap with a concrete diff.

## A documented-but-uncodified rule is itself a gap

The failure mode this rule exists to catch: a `🚨` line lands in CLAUDE.md, everyone nods, and nothing changes because no code fires when the rule is broken. If a discipline is worth a 🚨, it is worth an enforcer. When no enforceable surface exists today (the violation isn't visible to any tool, or the check needs off-machine state), say so in the rule and the detail doc. Don't leave the reader assuming an enforcer exists. Otherwise, codify it.
<!-- enforcement: human-review — this paragraph describes the enforcement model itself (when a rule has no codeable surface); the 🚨 here is meta-prose, not a discipline with its own enforcer -->
