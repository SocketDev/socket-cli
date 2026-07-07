---
name: fleet-reviewing-code
description: Reviews the current branch against a base ref using multiple AI backends. Runs a Workflow that streams the diff through discovery, discovery-secondary, remediation, and adversarial-verify stages, routing each stage to the available agents (codex, claude, opencode, kimi, …) and gracefully skipping any backend that isn't installed. Writes a markdown findings report under docs/. Use when preparing or updating a PR, before merging a feature branch, or when wanting an independent second opinion from a different agent.
user-invocable: true
allowed-tools: Workflow, Read, Grep, Glob, Bash(node:*), Bash(git:*), Bash(command -v:*)
model: claude-opus-4-8
context: fork
---

# reviewing-code

Four-pass multi-agent code review of the current branch against a base ref via a `Workflow`. The diff streams through discovery → discovery-secondary → remediation → verify stages, each routed to a different AI backend; findings are adversarially verified before they fold into one markdown report.

## When to use

- Reviewing a feature branch before opening (or after updating) a PR.
- Getting a second-and-third opinion from a different agent than the one currently editing.
- Surfacing real bugs / regressions / data-integrity issues, not style.
- Establishing a paper trail for a tricky migration or compatibility-path change.

## Default pipeline

| Pass | Role                | Default backend | Output                                                      |
| ---- | ------------------- | --------------- | ----------------------------------------------------------- |
| 1    | spec-compliance     | `codex`         | creates report with `## Stated Intent` + `## Spec Compliance` |
| 2    | discovery           | `codex`         | adds findings below the spec section                        |
| 3    | discovery-secondary | `codex`         | merges into report (skipped if no new findings)             |
| 4    | remediation         | `codex`         | adds Suggested Fix + Suggested Regression Tests per finding |
| 5    | verify              | `claude`        | appends `## <Backend> Verification` section                 |

Per-role fallback order, hybrid-backend handling (`opencode`), and the graceful-detect / skip-with-note policy live in [`_shared/multi-agent-backends.md`](../_shared/multi-agent-backends.md). This skill is the canonical implementation of that contract.

## Spec compliance gates the quality passes

The ordering is a contract, not a preference: the **spec-compliance pass runs first and gates the quality passes** (discovery / remediation). It checks the change against its _stated intent_ for over-building, scope creep, and under-building — failure modes that are cheaper to catch before quality review than after, and that make a quality pass on out-of-scope code a wasted round-trip. The pass ends with an explicit `Spec compliance: PASS` / `CONCERNS` verdict line, and its `## Stated Intent` + `## Spec Compliance` sections are preserved through every later pass by a code-level guarantee in `run.mts` (`ensureSpecSection`), not by trusting each agent to keep them. The ordering is enforced by [`scripts/fleet/check/review-stages-are-ordered.mts`](../../../../scripts/fleet/check/review-stages-are-ordered.mts), so spec-compliance can't be reordered after a quality pass without failing `check --all`.

## Variant analysis on confirmed findings

For every High / Critical finding the verify pass marks `CONFIRMED`, run a variant search before closing the report. The same shape often hides elsewhere in the repo. The discipline (what to search for, how to scope, when to skip) lives in [`_shared/variant-analysis.md`](../_shared/variant-analysis.md). Append a `## Variant Analysis` section per finding when variants are found; omit the section when there are none rather than emit an empty header.

For security-class diffs specifically, run [`scanning-quality/scans/differential.md`](../scanning-quality/scans/differential.md) alongside this skill. That scan is the security-regression cousin to this skill's general review.

## Compounding lessons

When the same review finding has fired in two consecutive runs (or across two repos), promote it to a fleet rule per [`_shared/compound-lessons.md`](../_shared/compound-lessons.md). Don't keep catching the same bug; codify it once.

## Usage

Invoke the skill; it authors the `Workflow` inline. The following knobs are passed as `args` (the Workflow reads them when building scope + routing):

| Arg                          | Effect                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| _(none)_                     | Default: codex×3 + claude×1, output under `docs/<branch-slug>-review-findings.md` |
| `--base origin/main`         | Custom base ref for the diff                                                      |
| `--output docs/reviews/x.md` | Custom report path                                                                |
| `--skip-verify`              | Skip the adversarial verify phase (report marked unverified)                      |
| `--pass discovery=kimi`      | Override one or more passes' routed backend (repeatable)                          |
| `--only discovery,verify`    | Run only a subset of passes                                                       |

## Configuration via env vars

| Var               | Default       | Effect                                         |
| ----------------- | ------------- | ---------------------------------------------- |
| `CODEX_MODEL`     | `gpt-5.4`     | Codex model when codex is the active backend   |
| `CODEX_REASONING` | `xhigh`       | Codex reasoning effort                         |
| `CLAUDE_MODEL`    | `opus`        | Claude model when claude is the active backend |
| `KIMI_MODEL`      | `kimi-latest` | Kimi model when kimi is the active backend     |

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

## How the passes run: author a `Workflow`

Run the four passes as a **`Workflow`** (not ad-hoc `Task` spawns). The four passes are a strict pipeline — discovery feeds discovery-secondary feeds remediation feeds verify — and each finding carries structured fields the next stage reads, so the staged-`agent()` chain plus per-finding schemas is exactly the shape `Workflow` models. The skill invoking `Workflow` is a sanctioned opt-in; pass the base ref + pass overrides as `args`.

Author the script inline (don't pre-Write it). Shape:

1. **Resolve scope first (plain code, no agents).** Compute base ref + merge base + commit list + diff stat via `Bash(git:*)`. Detect which agent CLIs are on PATH via `Bash(command -v:*)`. Build a `pass → backend` map from the fallback order in [`_shared/multi-agent-backends.md`](../_shared/multi-agent-backends.md); `log()` any pass whose preferred backend is absent and which fallback (or skip) it took.
2. **`phase('Discovery')` — the find stages, streamed.** Model the review dimensions (the diffed files, or the configured `--only` subset) as a `pipeline(dimensions, discover, discoverSecondary)` so each dimension flows find → secondary-find without a barrier between dimensions. Each stage is an `agent()` whose `agentType` is the routed backend (codex / claude / opencode / kimi), `isolation` is read-only, and whose prompt is the pass prompt scoped to the base-ref diff. Every finder returns a `FINDINGS_SCHEMA` (`{ pass, findings: [{ file, line, severity: critical|high|medium|low, claim, affectedCode, why, impact }] }`). discovery-secondary merges only NEW findings (drop duplicates by `file:line:claim`).
3. **`phase('Remediation')` — dependent stage.** For each finding, one `agent()` (the remediation backend) adds `{ suggestedFix, suggestedRegressionTests }` to the finding. This depends on the full discovery set, so it runs after the discovery pipeline drains.
4. **`phase('Verify')` — adversarial pass.** Per High/Critical finding, spawn a skeptic `agent()` (the verify backend, default `claude`) that tries to REFUTE the finding against the actual diff, returning a `VERDICT_SCHEMA` (`{ isReal, verdict: confirmed|likely|false-positive, why }`). Drop findings the skeptic refutes before they land in the report; mark survivors `CONFIRMED`. Skip this phase when `--skip-verify` is set and `log()` that the report is unverified.
5. **`phase('Variant')` — for every `CONFIRMED` High/Critical finding**, one `agent()` searching the repo for the same shape per [`_shared/variant-analysis.md`](../_shared/variant-analysis.md); merge variants in. Omit the section entirely when none are found.
6. **Synthesize** — a final `agent()` takes the verified+variant JSON and writes the markdown report in the structure under [Output](#output) (overwrite on discovery, append the `## <Backend> Verification` section from the verify verdicts).

Return `{ report, findingCount, bySeverity }` from the script. The per-finding `FINDINGS_SCHEMA` / `VERDICT_SCHEMA` replace the free-text fold-up: each stage returns validated data the next stage reads instead of re-parsing prose. Backends absent from PATH are skipped with a `log()` note rather than failing the Workflow — the graceful-detect / skip-with-note policy in [`_shared/multi-agent-backends.md`](../_shared/multi-agent-backends.md) still governs routing. The pass prompts are the single source of truth so the pipeline and the prompts can't drift apart.
