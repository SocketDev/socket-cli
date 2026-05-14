# Agents & skills

The CLAUDE.md `### Agents & skills` section names the entry-point skills; this file is the full taxonomy and the cross-fleet runner.

## Entry-point skills

- `/scanning-security` — AgentShield + zizmor audit
- `/scanning-quality` — quality analysis
- Shared subskills in `.claude/skills/_shared/`
- **Handing off to another agent** — see [`agent-delegation.md`](agent-delegation.md) for when to reach for `codex:codex-rescue`, the `delegate` subagent (OpenCode → Fireworks/Synthetic/Kimi), `Explore`, `Plan`, vs. driving the skill CLIs directly. The CLI-subprocess contract used by skills lives in [`_shared/multi-agent-backends.md`](../../.claude/skills/_shared/multi-agent-backends.md).

## Skill scope: fleet vs partial vs unique

Every skill under `.claude/skills/` falls into one of three tiers — surface this distinction when adding a new skill so it lands in the right place:

- **Fleet skill** — present in every fleet repo, identical contract everywhere. Examples: `guarding-paths`, `scanning-quality`, `scanning-security`, `updating`, `locking-down-programmatic-claude`, `plug-leaking-promise-race`. New fleet skills land in `socket-wheelhouse/template/.claude/skills/<name>/` and cascade via `node socket-wheelhouse/scripts/sync-scaffolding.mts --all --fix`. Track them in `SHARED_SKILL_FILES` in the sync manifest.
- **Partial skill** — present in the subset of repos that need it, identical contract within that subset. Examples: `driving-cursor-bugbot` (every repo with PR review), `updating-lockstep` (every repo with `lockstep.json`), `squashing-history` (repos with the squash workflow). Live in each adopting repo's `.claude/skills/<name>/`. When you change one, propagate to the others.
- **Unique skill** — one repo only, bespoke to that repo's domain. Examples: `updating-cdxgen` (sdxgen), `updating-yoga` (socket-btm), `release` (socket-registry). Never canonical-tracked; the host repo owns it end-to-end.

Audit the current classification with `node socket-wheelhouse/scripts/run-skill-fleet.mts --list-skills`.

## `updating` umbrella + `updating-*` siblings

`updating` is the canonical fleet umbrella that runs `pnpm run update` then discovers and runs every `updating-*` sibling skill the host repo registers. The umbrella is fleet-shared; the siblings are per-repo (or partial — e.g. `updating-lockstep` lives in every repo with `lockstep.json`). To add a new repo-specific update step, drop a new `.claude/skills/updating-<domain>/SKILL.md` and the umbrella picks it up automatically — no edits to `updating` itself.

## Running skills across the fleet

`scripts/run-skill-fleet.mts` (in `socket-wheelhouse`) spawns one headless `claude --print` agent per fleet repo, in parallel (concurrency 4 by default), with the four lockdown flags set per the _Programmatic Claude calls_ rule above. Per-skill profile table maps known skills to sensible tool/allow/disallow lists; override with `--tools` / `--allow` / `--disallow`. Per-repo logs land in `.cache/fleet-skill/<timestamp>-<skill>/<repo>.log`. Use `Promise.allSettled` semantics — one repo's failure doesn't abort the rest.

```bash
pnpm run fleet-skill updating                       # update every fleet repo
pnpm run fleet-skill scanning-quality --concurrency 2 # slower, more conservative
pnpm run fleet-skill --list-skills                  # classify skills fleet/partial/unique
```
