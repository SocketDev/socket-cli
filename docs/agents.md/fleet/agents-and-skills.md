# Agents & skills

The CLAUDE.md `### Agents & skills` section names the entry-point skills. This file is the full taxonomy and the cross-fleet runner. Before authoring a new skill, read [`writing-skills-well.md`](writing-skills-well.md) — the fleet skill-authoring doctrine (script-first/AI-residue steps, completion criteria, leading words, no-op pruning).

## Naming & namespace

Fleet skills live at `.claude/skills/fleet/<name>/SKILL.md`; fleet commands at `.claude/commands/fleet/<name>.md`. Claude Code derives the namespace from the `fleet/` directory, so both autocomplete as `fleet:<name>` — type `/fleet:` + Tab to browse the whole group. The `name:` frontmatter stays **bare** (`name: scanning-quality`, never `fleet:scanning-quality`); the prefix is a display affordance, not part of the name. Invoke either `/<name>` or `/fleet:<name>` — both resolve. When one skill references another (in prose or a `Skill` call), use the bare name. Skill names use action-oriented phrases (`scanning-quality`, `looping-quality`, `greening-ci`, `map`); a paired command shares the skill's name.

## Operating map

[`skill-system.mts`](../../../scripts/fleet/lib/skill-system.mts) classifies every fleet
skill and declares the enforced handoffs. Start with the current state, then follow the
named successor:

| State      | Path                                                                             |
| ---------- | -------------------------------------------------------------------------------- |
| Understand | `setup-repo` / `map` → `authoring-spec`                                          |
| Decide     | `authoring-spec` → `grilling-plan` → `decomposing-tickets`                       |
| Build      | `building-tdd` → `reviewing-code` → `pushing`                                    |
| Assess     | `scanning-quality` → `looping-quality`                                           |
| Secure     | `threat-modeling` → `scanning-vulns` → `triaging-findings` → `patching-findings` |
| Ship       | `agent-ci` → `opening-pr` / `pushing` → `greening-ci`                            |
| Propagate  | `cascading-fleet` or narrow `syncing-fleet`                                      |
| Maintain   | `updating` → `updating-security` → `cascading-fleet`                             |
| Design     | `designing-interfaces` → build/review/performance/test companions                |

## Entry-point skills

- `/fleet:scanning-security`: AgentShield + zizmor audit
- `/fleet:scanning-quality`: quality assessment plus explicit maintenance/report mutations
- `/fleet:looping-quality`: loop driver over `scanning-quality` — scan, fix, re-scan until clean or 5 iterations (interactive; makes commits)

The **code-security loop** is four chained skills, each leg resumable (see [`security-stack.md`](security-stack.md) Layer 6 for the full contract):

- `/fleet:threat-modeling`: map the attack surface → `THREAT_MODEL.md` (interview / bootstrap / bootstrap-then-interview)
- `/fleet:scanning-vulns`: static vulnerability scan of an arbitrary target tree → `VULN-FINDINGS.json` (read-only; never drops a finding)
- `/fleet:triaging-findings`: N blind verifiers per finding → `TRIAGE.json` (verify, dedupe, exploitability re-rank, owner routing; read-only)
- `/fleet:patching-findings`: per true-positive, patch agent + blind reviewer → applied commits (mutating; `--dry-run` previews)

- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent**: see [`agent-delegation.md`](agent-delegation.md) for when to reach for `codex:codex-rescue`, the `delegate` subagent (OpenCode → Fireworks/Synthetic/Kimi), `Explore`, `Plan`, vs. driving the skill CLIs directly. The CLI-subprocess contract used by skills lives in [`_shared/multi-agent-backends.md`](../../.claude/skills/fleet/_shared/multi-agent-backends.md).

## Skill scope: fleet vs partial vs unique

Every skill under `.claude/skills/` falls into one of three tiers. Surface this distinction when adding a new skill so it lands in the right place:

- **Fleet skill**: present in every fleet repo, identical contract everywhere. Examples: `guarding-paths`, `scanning-quality`, `looping-quality`, `scanning-security`, `threat-modeling`, `scanning-vulns`, `triaging-findings`, `patching-findings`, `updating`, `locking-down-claude`, `plugging-promise-race`. New fleet skills land in `template/.claude/skills/fleet/<name>/` and cascade via `node scripts/sync-scaffolding.mts --all --fix`. The whole `.claude/skills/fleet` tree is tracked as a directory in the sync manifest, so a new skill dir cascades with no manifest edit.
- **Partial skill**: present in the subset of repos that need it, identical contract within that subset. Examples: `driving-cursor-bugbot` (every repo with PR review), `updating-lockstep` (every repo with `lockstep.json`), `squashing-history` (repos with the squash workflow). Live in each adopting repo's `.claude/skills/<name>/`. When you change one, propagate to the others.
- **Unique skill**: one repo only, bespoke to that repo's domain. Examples: `updating-cdxgen` (sdxgen), `updating-yoga` (socket-btm), `release` (socket-registry). Never canonical-tracked; the host repo owns it end-to-end.

Audit the current classification with `node scripts/run-skill-fleet.mts --list-skills`.

## `updating` umbrella + `updating-*` siblings

`updating` is the canonical fleet umbrella that runs `pnpm run update` then discovers and runs every `updating-*` sibling skill the host repo registers. The umbrella is fleet-shared; the siblings are per-repo (or partial: `updating-lockstep` lives in every repo with `lockstep.json`). To add a new repo-specific update step, drop a new `.claude/skills/updating-<domain>/SKILL.md` and the umbrella picks it up automatically. No edits to `updating` itself.

## Running skills across the fleet

`scripts/run-skill-fleet.mts` (in the fleet source repo) spawns one headless `claude --print` agent per fleet repo, in parallel (concurrency 4 by default), with the four lockdown flags set per the _Programmatic Claude calls_ rule above. Per-skill profile table maps known skills to sensible tool/allow/disallow lists; override with `--tools` / `--allow` / `--disallow`. Per-repo logs land in `.cache/fleet-skill/<timestamp>-<skill>/<repo>.log`. Uses `Promise.allSettled` semantics; one repo's failure doesn't abort the rest.

```bash
# Run from inside the fleet source repo:
pnpm run fleet-skill updating                          # update every fleet repo
pnpm run fleet-skill scanning-quality --concurrency 2  # slower, more conservative
pnpm run fleet-skill --list-skills                     # classify skills fleet/partial/unique
```
