---
name: scanning-security
description: Run AgentShield, zizmor, and optional Socket dependency scans, then produce a graded security report.
user-invocable: true
allowed-tools: Task, Read, Write, Bash(node scripts/fleet/security.mts:*), Bash(node scripts/fleet/lib/security-report.mts:*), Bash(node .claude/skills/fleet/_shared/scripts/checkpoint.mts:*)
model: claude-opus-4-8
context: fork
---

# scanning-security

Multi-tool security scanning pipeline for the repository.

## When to Use

- After modifying `.claude/` config, settings, hooks, or agent definitions
- After modifying GitHub Actions workflows
- Before releases (called as a gate by the release pipeline)
- Periodic security hygiene checks

## Prerequisites

See `_shared/security-tools.md` for tool detection and installation.

## Process

### Phase 1: Environment Check

Follow `_shared/env-check.md`. Initialize a queue run entry for `scanning-security` with the existing atomic phased-state writer — the runbook skills use it too: `node .claude/skills/fleet/_shared/scripts/checkpoint.mts save <state> 1`. Advance it the same way as each phase completes, rather than prose-editing `queue.yaml` by hand.

---

### Phase 2 + 3: Run both scans

The two static scans (AgentShield over `.claude/`, zizmor over `.github/`) are run by the canonical runner, which captures each tool's output and the skip list:

```bash
node scripts/fleet/security.mts --json > <state>/scan.json
```

The `--json` envelope is `{ agentshield: { code, output }, zizmor: { code, output }, skipped: [...] }`. A tool not installed lands in `skipped` — the runner prints the `setup-security-tools` hint in non-JSON mode; the scan continues rather than failing. AgentShield checks `.claude/` for hardcoded secrets, overly-permissive allow lists, prompt-injection patterns, command-injection in hooks, risky MCP config. zizmor checks `.github/` for unpinned actions, secret exposure, template injection, permission issues. Advance the checkpoint after the run.

---

### Phase 4: Grade + Report

Spawn the `security-reviewer` agent (see `agents/security-reviewer.md`) with the captured scan output. The agent applies CLAUDE.md security rules, assigns each finding a severity, writes the prioritized report (CRITICAL first) with fixes for HIGH/CRITICAL, and runs variant analysis per [`_shared/variant-analysis.md`](../_shared/variant-analysis.md) on every Critical/High — the same misconfiguration likely repeats across sibling workflows, Claude config blocks, or repos. That is the judgment.

Then the deterministic grade + envelope: the agent writes the assigned `{critical, high, medium, low}` counts to a JSON file, and the skill computes the grade + HANDOFF block from it so the rubric can never drift from `_shared/report-format.md`:

```bash
node scripts/fleet/lib/security-report.mts grade --from <state>/counts.json     # → the A-F letter
node scripts/fleet/lib/security-report.mts handoff --from <state>/handoff.json   # → the === HANDOFF === block
```

`handoff.json` is `{ skill, status, counts, summary }` — the grade is computed from counts when omitted. Close the checkpoint: `node .claude/skills/fleet/_shared/scripts/checkpoint.mts done <state> <N>`.

## Reference

For rule catalogs (AgentShield + zizmor), common false positives, the severity decision tree, and fix recipes — load [reference.md](./reference.md) when triaging findings.

## Adjacent scans

Code-side security (insecure defaults, fail-open patterns, security-regression in a diff) lives in `scanning-quality`'s modular scans:

- [`scanning-quality/scans/insecure-defaults.md`](../scanning-quality/scans/insecure-defaults.md): code-side fail-open defaults.
- [`scanning-quality/scans/differential.md`](../scanning-quality/scans/differential.md): security regressions introduced by the current diff.

This skill stays focused on **config security** (Claude config + GitHub Actions). The split keeps the surface predictable: `scanning-security` = "is the harness safe?", `scanning-quality/scans/` = "is the code safe?".

## Commit cadence

This skill is read-only: scan + grade + report, no fixes. Cadence rules apply to handing the report off:

- **Save the report to the untracked location.** Write it to `.claude/reports/scanning-security-YYYY-MM-DD.md` — the report location the fleet `.gitignore` excludes per the _Plan & report storage_ rule, never a committable `reports/` or `docs/reports/` path, never committed. It is a local reference for the grade trend, not an artifact.
- **Don't fix in-skill.** Security findings need careful per-finding triage; they're not safe to batch-fix mechanically. Open per-finding fixes as separate commits driven by the appropriate skill (or hand-edit when the fix is a one-liner like a workflow SHA bump).
- **One report per scan run.** Re-running produces a new report; commit each so the security trend line is auditable.
