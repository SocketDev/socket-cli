# Differential scan

Security-focused review of the **diff** between the current branch and a base ref. Different from `reviewing-code`'s general review — this scan looks specifically at security regressions introduced by the diff.

## Mission

Treat every line that changed since the base ref as a candidate for a security regression. Surface findings the reviewer should triage **before** merging.

## Scope

- Range: `git diff <base> HEAD`. Default base resolves via the fleet's default-branch fallback — prefer `origin/main`, fall back to `origin/master`:

  ```bash
  BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
  if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main;   then BASE=main;   fi
  if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then BASE=master; fi
  BASE="${BASE:-main}"
  git diff "origin/$BASE" HEAD -- <file globs>
  ```

- Filter: code files only — `.{ts,mts,tsx,js,mjs,cjs,jsx,go,rs,py,sh}` and YAML workflows.
- Skip: test fixtures, snapshot files, lockfiles, generated bundles.

## What this scan looks for

| Class                                  | Trigger pattern                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Newly-introduced fetch / network calls | `+\s*fetch\(`, `+\s*axios\.`, raw `https.request(` — does the new call go to a trusted host? Is the URL constructed from untrusted input? |
| Newly-introduced env-var reads         | `+\s*process\.env\.` — does the diff add a new env input? Where is it validated?                                                          |
| Newly-introduced filesystem ops        | `+\s*fs\.(rm\|writeFile\|chmod)` — does the path come from input?                                                                         |
| Permissions / role changes             | `permissions:`, `if: github.actor`, role assignments in DB migrations                                                                     |
| Disabled checks                        | `+\s*//\s*eslint-disable`, `+\s*@ts-ignore`, `skip:`, `if: false` — the diff added a bypass                                               |
| Commented-out security code            | `^-\s*(verify\|validate\|assert)` — the diff removed a check                                                                              |
| New raw SQL / shell exec               | `+\s*\$\{.*\}\s*\)` inside a `query(` or `exec(` — interpolation into a sensitive sink                                                    |
| Token / secret string changes          | any `+` line that mentions `token`, `secret`, `password`, `key` and isn't a type / label                                                  |

## Method

1. Resolve the diff: `git diff --no-color <base> HEAD -- <file globs>`.
2. For each hunk, classify changes against the table above.
3. Cross-reference with `_shared/variant-analysis.md` — if the diff introduces a pattern flagged here, search the rest of the repo for that pattern (it may already be wrong elsewhere too).
4. Skip noise: pure renames, formatting-only diffs, generated file regenerations.

## Output shape

```
### Differential Scan (base: <ref>)

Files changed: N
Lines added: A
Lines removed: D

#### Findings introduced by the diff

- file:line (added in <commit>)
  Class: <new fetch | disabled check | …>
  Hunk: <3-line excerpt>
  Severity: <Critical | High | Medium>
  Why: <one sentence>
  Fix: <imperative>

#### Findings removed by the diff (regression candidates)

- file:line (removed in <commit>)
  Removed: <description of safety mechanism>
  Was guarding: <what it protected>
  Action: confirm the protection is still enforced elsewhere, or restore it
```

## When to run

- Before opening a PR (`reviewing-code` already runs general review; this is the security-specific cousin).
- When CI flags a security-class regression.
- After a refactor that touched `auth/`, `crypto/`, `validate/`, `permissions.{ts,mts}`, or workflow YAML.

## When to skip

- Pure dependency bumps — the bump is what `updating-lockstep` reviews.
- Branches with zero code changes (docs-only / config-only diffs unrelated to security).

## Source

Pattern adapted from Trail of Bits' `differential-review` plugin (https://github.com/trailofbits/skills/tree/main/plugins/differential-review). Their version emits SARIF for CodeQL/Semgrep ingestion; ours emits markdown for the same review report `reviewing-code` produces.
