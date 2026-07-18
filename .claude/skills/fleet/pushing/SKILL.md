---
name: pushing
description: Run the full pre-push gate, push only when green, then watch CI after the push.
user-invocable: true
allowed-tools: Bash(node:*), Bash(git:*), Bash(gh:*)
model: claude-haiku-4-5
context: fork
---

# pushing

Landing on local main is the default; pushing origin is deliberate — the wheelhouse is the fleet's canonical source (members cascade from origin/main), so a red push breaks the fleet. This skill gates the push, then drives CI to green.

## Run the gate

```bash
node scripts/fleet/pre-push-gate.mts
```

Runs in order, stopping + failing loud on the first red step:

1. `pnpm run update` — refresh tool/catalog pins (soak-held stay held)
2. `pnpm install` — reconcile the lockfile
3. `pnpm run fix --all` — lint/format autofix
4. `pnpm run check --all` — the fleet check gates
5. `pnpm run cover` — full coverage suite (covers "all tests pass")

## On GREEN

Push, then drive CI to green — don't walk away on a red run (the `post-push-ci-monitor-nudge` hook reminds you):

```bash
git push
gh run watch
```

If `pnpm run update` / `pnpm install` changed the lockfile or pins, commit those first (the lockfile-only `-o pnpm-lock.yaml` reconcile is sanctioned), then re-run the gate. The gate never pushes for you — it only tells you it is safe to.

## Handoffs

Run [agent-ci](../agent-ci/SKILL.md) before CI-sensitive pushes when Docker is available.
After the push, use [greening-ci](../greening-ci/SKILL.md) until remote CI is green.
