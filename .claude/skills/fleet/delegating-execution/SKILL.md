---
name: delegating-execution
description: Route non-trivial build/design work through the tier cycle — big-brain plan, floor execute, big-brain review, floor follow-up. Use when a task deserves a written plan and the execution is delegable grunt work; benign infra/docs planning routes to Fable, security-sensitive planning to Opus 4.8.
user-invocable: true
argument-hint: '<task summary> [benign|security]'
allowed-tools: Bash(node:*), Read, Workflow, Write
model: claude-sonnet-4-6
context: fork
---

# delegating-execution

The fleet tier doctrine: Fable plans, a lesser model executes, Fable reviews, the lesser model follows up. This skill is the EXECUTION-tiering complement to `grilling-plan` (which stress-tests a plan's content interactively before building) and operates at the Workflow-harness tier (`agent({model, effort})`). The CLI-subprocess layer — codex/opencode/kimi backends and when to prefer each — is documented in [`.claude/skills/fleet/_shared/multi-agent-backends.md`](../_shared/multi-agent-backends.md); this skill sits above it on the Anthropic Workflow tier.

## When to use

- Non-trivial build/design work: multi-file changes, new enforcement surfaces, cross-repo cascades.
- Work whose plan is a deliverable (`plan-review-nudge` shape: numbered steps, named files + rules).
- NOT for one-file fixes — just do them.
- NOT for plan critique — that is `grilling-plan`; run it before this skill when the design is unsettled.

## The cycle

1. **Plan** — big brain writes the numbered plan + a fenced execution prompt to `.claude/plans/`.
2. **Execute** — floor model follows the plan verbatim in a `git worktree`.
3. **Review** — big brain diffs the result against the plan; emits severity + `file:line` findings.
4. **Follow-up** — floor model applies each finding, re-runs gates, commits.

## Sensitivity routing

Mirror — source of truth: `scripts/fleet/lib/delegating-execution/route.mts`.

| phase    | sensitivity | model               | effort      |
|----------|-------------|---------------------|-------------|
| plan     | benign      | `claude-fable-5`    | `undefined` |
| plan     | security    | `claude-opus-4-8`   | `high`      |
| review   | benign      | `claude-fable-5`    | `undefined` |
| review   | security    | `claude-opus-4-8`   | `high`      |
| execute  | benign      | `claude-sonnet-4-6` | `medium`    |
| execute  | security    | `claude-sonnet-4-6` | `medium`    |
| followup | benign      | `claude-sonnet-4-6` | `medium`    |
| followup | security    | `claude-sonnet-4-6` | `medium`    |

- Benign infra/docs planning → Fable (apex tier; adaptive-only, no effort knob).
- Security-sensitive planning (vuln analysis, supply-chain, auth/token/secret handling, exploit-adjacent, hardening) → Opus 4.8 DIRECTLY: Fable's classifiers false-positive on benign security work and the refusal→Opus fallback in `spawnAiAgent` is not live yet (upstream socket-lib; see [`fable-fallback`](../../../../docs/agents.md/fleet/fable-fallback.md)). When unsure, say `security` — the workflow also defaults to it (fail-safe).

## How to invoke

```js
Workflow({ name: "delegating-execution", args: { sensitivity: "benign" | "security", task: "<one-paragraph task summary>" } })
```

`sensitivity` is optional and defaults to `"security"`.

## Output contract

- The plan phase writes `.claude/plans/delegating-<slug>.md` containing (a) the numbered plan naming files + rules and (b) a fenced execution prompt the floor model runs verbatim.
- Review findings and follow-up receipts are appended to the same doc.
- Plans never land on a committable path (`plan-location-guard`).

## Backing code

- `scripts/fleet/lib/delegating-execution/route.mts` — the canonical tier table.
- `scripts/fleet/lib/delegating-execution/prompts.mts` — phase prompt builders (source of truth; the workflow JS carries a mirror).
- `.claude/workflows/delegating-execution.js` — the Workflow runner.
