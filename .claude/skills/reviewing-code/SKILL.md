---
name: reviewing-code
description: Reviews the current branch against a base ref using multiple AI backends. Routes discovery, discovery-secondary, remediation, and verify passes through the available agents (codex, claude, opencode, kimi, …), gracefully skipping any backend that isn't installed. Writes a markdown findings report under docs/. Use when preparing or updating a PR, before merging a feature branch, or when wanting an independent second opinion from a different agent.
user-invocable: true
allowed-tools: Read, Grep, Glob, Bash(node:*), Bash(git:*), Bash(command -v:*)
---

# reviewing-code

Four-pass multi-agent code review of the current branch against a base ref. Each pass is a separate agent run with a focused prompt; the results fold into one markdown report.

## When to use

- Reviewing a feature branch before opening (or after updating) a PR.
- Getting a second-and-third opinion from a different agent than the one currently editing.
- Surfacing real bugs / regressions / data-integrity issues — not style.
- Establishing a paper trail for a tricky migration or compatibility-path change.

## Default pipeline

| Pass | Role                  | Default backend  | Output |
|------|-----------------------|------------------|--------|
| 1    | discovery             | `codex`          | overwrites report |
| 2    | discovery-secondary   | `codex`          | merges into report (skipped if no new findings) |
| 3    | remediation           | `codex`          | adds Suggested Fix + Suggested Regression Tests per finding |
| 4    | verify                | `claude`         | appends `## <Backend> Verification` section |

Per-role fallback order, hybrid-backend handling (`opencode`), and the graceful-detect / skip-with-note policy live in [`_shared/multi-agent-backends.md`](../_shared/multi-agent-backends.md). This skill is the canonical implementation of that contract.

## Variant analysis on confirmed findings

For every High / Critical finding the verify pass marks `CONFIRMED`, run a variant search before closing the report — the same shape often hides elsewhere in the repo. The discipline (what to search for, how to scope, when to skip) lives in [`_shared/variant-analysis.md`](../_shared/variant-analysis.md). Append a `## Variant Analysis` section per finding when variants are found; omit the section when there are none rather than emit an empty header.

For security-class diffs specifically, run [`scanning-quality/scans/differential.md`](../scanning-quality/scans/differential.md) alongside this skill — that scan is the security-regression cousin to this skill's general review.

## Compounding lessons

When the same review finding has fired in two consecutive runs (or across two repos), promote it to a fleet rule per [`_shared/compound-lessons.md`](../_shared/compound-lessons.md). Don't keep catching the same bug; codify it once.

## Usage

```bash
# Default: codex×3 + claude×1, output under docs/<branch-slug>-review-findings.md
node .claude/skills/reviewing-code/run.mts

# Custom base
node .claude/skills/reviewing-code/run.mts --base origin/main

# Custom output
node .claude/skills/reviewing-code/run.mts --output docs/reviews/my-branch.md

# Skip the verify pass entirely
node .claude/skills/reviewing-code/run.mts --skip-verify

# Override one or more passes
node .claude/skills/reviewing-code/run.mts --pass discovery=kimi --pass verify=opencode

# Cleanup the temp dir on exit (default keeps logs for inspection)
node .claude/skills/reviewing-code/run.mts --cleanup-temp

# Run only a subset of passes
node .claude/skills/reviewing-code/run.mts --only discovery,verify
```

## Configuration via env vars

| Var | Default | Effect |
|---|---|---|
| `CODEX_MODEL` | `gpt-5.4` | Codex model when codex is the active backend |
| `CODEX_REASONING` | `xhigh` | Codex reasoning effort |
| `CLAUDE_MODEL` | `opus` | Claude model when claude is the active backend |
| `KIMI_MODEL` | `kimi-latest` | Kimi model when kimi is the active backend |

## Output

A single markdown file (`docs/<branch-slug>-review-findings.md` by default) with this structure:

```
# <descriptive title>
## Scope
## Executive Summary
## Findings
### 1. <title>
   Severity, Summary, Affected Code, Why This Is A Problem, Impact,
   Suggested Fix, Suggested Regression Tests
## Assumptions / Gaps
## Validation Notes
## Suggested Next Steps
---
## <Backend> Verification
   Per-finding verdict (CONFIRMED / LIKELY / FALSE POSITIVE),
   fix soundness, missed findings, overall recommendation.
```

## How the runner works

`run.mts` is a self-contained TypeScript runner that:

1. Resolves base ref + merge base + commit list + diff stat.
2. Detects which agent CLIs are available on PATH.
3. For each pass, picks the preferred backend per the fallback order (or skips with a documented note).
4. Writes per-pass prompts to a temp dir and runs the agent non-interactively.
5. Folds outputs into the final report.

The prompts live in the runner — single source of truth so the pipeline and the prompts can't drift apart.
