---
name: security-scan
description: Runs a multi-tool security scan — AgentShield for Claude config, zizmor for GitHub Actions, and optionally Socket CLI for dependency scanning. Produces an A-F graded security report. Use after modifying `.claude/` config, hooks, agents, or GitHub Actions workflows, and before releases.
user-invocable: true
---

# Security Scan

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

Follow `_shared/env-check.md`. Initialize a queue run entry for `security-scan`.

---

### Phase 2: AgentShield Scan

Scan Claude Code configuration for security issues:

```bash
pnpm exec agentshield scan
```

Checks `.claude/` for:
- Hardcoded secrets in CLAUDE.md and settings
- Overly permissive tool allow lists (e.g. `Bash(*)`)
- Prompt injection patterns in agent definitions
- Command injection risks in hooks
- Risky MCP server configurations

Capture the grade and findings count.

Update queue: `current_phase: agentshield` → `completed_phases: [env-check, agentshield]`

---

### Phase 3: Zizmor Scan

Scan GitHub Actions workflows for security issues.

See `_shared/security-tools.md` for zizmor detection. If not installed, skip with a warning.

```bash
zizmor .github/
```

Checks for:
- Unpinned actions (must use full SHA, not tags)
- Secrets used outside `env:` blocks
- Injection risks from untrusted inputs (template injection)
- Overly permissive permissions

Capture findings. Update queue phase.

---

### Phase 4: Grade + Report

Spawn the `security-reviewer` agent (see `agents/security-reviewer.md`) with the combined output from AgentShield and zizmor.

The agent:
1. Applies CLAUDE.md security rules to evaluate the findings
2. Calculates an A-F grade per `_shared/report-format.md`
3. Generates a prioritized report (CRITICAL first)
4. Suggests fixes for HIGH and CRITICAL findings

Output a HANDOFF block per `_shared/report-format.md` for pipeline chaining.

Update queue: `status: done`, write `findings_count` and final grade.
