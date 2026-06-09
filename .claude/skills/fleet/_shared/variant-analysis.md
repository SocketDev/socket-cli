# Variant analysis

When a finding lands — a bug, a regression, a security issue — the next question is always: **does this same shape exist anywhere else in the repo?** Variant analysis is the systematic answer.

## Why this exists

A bug is rarely unique. The mental model that produced it usually produced siblings. The reviewer who didn't catch it once usually missed the rest. Treating each finding as one-off leaks variants into production.

This file is referenced by `scanning-quality` (variant-analysis scan type), `scanning-security`, and `reviewing-code`.

## The pattern

For every confirmed finding, run three searches before closing it out:

1. **Same file, different lines** — the antipattern often clusters within the file that exhibits it. Read the whole file, not just the diff.
2. **Sibling files, same shape** — `rg`/`grep` for the same call, the same condition, the same data flow. If the bug was `if (foo == null)`, search for that exact shape.
3. **Cross-package, same concept** — does another package own a parallel implementation? If `socket-cli` has the bug, does `socket-registry` have it too? Fleet drift loves to hide variants.

## What counts as "the same shape"

| Bug class          | What to search for                                                           |
| ------------------ | ---------------------------------------------------------------------------- |
| Missing null check | the call before the access — `foo.bar()` where `foo` could be undefined      |
| Race condition     | the lock primitive + the call sequence                                       |
| Path construction  | literal `path.join('build', …)` outside the canonical `paths.mts`            |
| Insecure default   | the option name, the boolean default, the env-var fallback                   |
| Token leak         | the field name (`token`, `api_key`, …), the log statement, the error message |
| Promise.race leak  | `Promise.race(`, `Promise.any(` inside a `for`/`while`                       |
| Forbidden API      | `fetch(`, `fs.rm(`, `fs.access(`, raw `npx` / `pnpm dlx`                     |

## Outputs

For each variant found, emit:

```
- file:line — variant of <original-finding-id>
  Pattern: <one-line shape>
  Severity: <propagate from original, or LOWER if context differs>
  Fix: <reference original fix, or note where it diverges>
```

Variants should be batched into the same fix commit when mechanical (one find/replace), or filed as sibling commits on the same branch when each needs review.

## Don't

- Don't variant-hunt for style nits. Reserve this for correctness / security / fleet-drift findings.
- Don't expand the search radius past one repo without writing it down — cross-fleet variants get a `chore(wheelhouse): cascade <fix>` PR per the _Drift watch_ rule.
- Don't skip the search because the finding "looks unique." Looking unique is exactly when the search pays off.
- Don't FIX the variant in a cascaded path. When a sweep edits matches, EXCLUDE the cascade-owned trees — `scripts/fleet/`, `.config/fleet/`, `.claude/hooks/fleet/`, `.git-hooks/`, `.claude/skills/fleet/`, `docs/claude.md/fleet/` — and `.claude/worktrees/`. Those flow FROM `socket-wheelhouse/template/`; editing them downstream forks a canonical file (trips `no-fleet-fork-guard`) and the next cascade clobbers it. Fix cascaded matches in the wheelhouse `template/` copy once, then cascade. `.claude/worktrees/` holds stale per-workflow checkouts whose hits are false positives. Grep with these exclusions when verifying a sweep is complete, not just when editing.

## Trail-of-Bits influence

This pattern is borrowed from Trail of Bits' `variant-analysis` plugin (https://github.com/trailofbits/skills) and adapted to the fleet's drift-watch discipline. Their version is Semgrep-rule-driven for security; ours is `rg`-driven for general correctness. Same idea, lighter machinery.
