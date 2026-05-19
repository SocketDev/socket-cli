---
name: cascading-fleet
description: Propagate a wheelhouse template change to every fleet repo (or a registry-pin chain to every dependent repo). Packages the canonical fleet-repo list, the FLEET_SYNC=1 sentinel pattern, the worktree-per-repo loop, push-direct + PR-fallback, and worktree-cleanup that survives mid-loop crashes. Use when a wheelhouse template SHA needs to land in every fleet repo, when a registry pin chain needs propagation, or when batching multiple template SHAs into one cascade wave.
user-invocable: true
allowed-tools: Bash(git fetch:*), Bash(git worktree:*), Bash(git branch:*), Bash(git status:*), Bash(git rev-list:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git push:*), Bash(git commit:*), Bash(git add:*), Bash(git log:*), Bash(node:*), Bash(gh pr create:*), Bash(gh repo view:*), Read, Bash(bash:*), Bash(chmod:*), Bash(cd:*), Bash(printf:*), Bash(echo:*), Bash(tee:*), Bash(tail:*), Bash(ls:*)
---

# cascading-fleet

The fleet runs on `chore(sync): cascade fleet template@<sha>` commits — every wheelhouse template change has to land in every fleet repo to take effect. This skill packages the operation so it isn't recreated ad-hoc per session.

## When to use

- A wheelhouse `template/` SHA needs to propagate to every fleet repo.
- A `socket-registry` pin chain (the multi-layer setup-and-install → setup → checkout pin graph) needs propagation.
- Batching multiple template SHAs into one wave.

Never use this skill while another cascade is in flight (each cascade creates a `chore/sync-<sha>` branch per repo; concurrent runs collide).

## Two modes

### Mode 1 — `template` (outer cascade, default)

Propagates a `socket-wheelhouse/template/` SHA to every fleet repo. The flow:

1. For each fleet repo:
2. Worktree off `origin/<default-branch>` on a fresh `chore/sync-<sha>` branch.
3. Run `socket-wheelhouse/scripts/sync-scaffolding/cli.mts --target <wt> --fix`.
4. If the cascade modified anything: surgical-stage with `FLEET_SYNC=1 git add --update`, commit `chore(sync): cascade fleet template@<sha>`, push direct to base.
5. If direct push is rejected: push the branch, open a PR.
6. Clean up the worktree + the temp branch.

The `FLEET_SYNC=1` sentinel is recognized by the wheelhouse `no-revert-guard` + `overeager-staging-guard` hooks. It allowlists exactly: `git commit --no-verify` whose message starts with `chore(sync): cascade fleet template@`, `git push --no-verify`, and `git add -A`/`-u`/`.`. Nothing else.

### Mode 2 — `registry-pins`

Propagates a `socket-registry` pin chain through the fleet. Different shape — uses `scripts/cascade-registry-pins.mts --sha <M'>` to walk the per-repo workflow pins. Documented here for completeness; the cascade script in `lib/cascade-template.sh` covers Mode 1, and a future `lib/cascade-registry-pins.sh` will cover Mode 2.

For now, the registry-pin cascade is two steps documented inline:

```
Step 1 (intra-registry): node socket-registry/scripts/cascade-internal.mts
Step 2 (intra-registry): git push to registry main; record new tip M'.
Step 3 (fleet-wide): node socket-wheelhouse/scripts/cascade-registry-pins.mts --sha M'
```

Skipping Step 1 means Step 3 propagates a SHA whose dependency graph still pins the pre-fix revision. Always run Step 1 first.

## How to invoke

```bash
# Mode 1 — propagate wheelhouse template SHA
bash .claude/skills/cascading-fleet/lib/cascade-template.sh <template-sha>
```

The script reads the fleet-repo list from `lib/fleet-repos.txt` (single source of truth), iterates, and writes a per-repo result line to stdout. Output also tees to `/tmp/cascade-<sha>.log` for post-hoc inspection.

## Worktree cleanup — the branch-cleanup bug

A subtle gotcha: the script's pre-clean step (`git branch -D <branch>`) MUST run from `${src}` (the source repo), not from `/tmp` or the worktree directory. If the loop crashes mid-iteration before `cd`-ing into the worktree, a stale `chore/sync-<sha>` branch can be left behind. The provided script handles this — but if you write a one-off cascade, make sure your cleanup runs from the right cwd.

## Soak time before catalog cascades

If the wheelhouse template change includes a `@socketsecurity/lib` catalog bump in `pnpm-workspace.yaml`, wait at least 5 minutes after the npm publish completes before starting the cascade. The cascade's `pnpm install` step will 404 if the new version isn't yet visible on the npm CDN.

## Stop conditions

- Branch already exists in a fleet repo (`fatal: a branch named 'chore/sync-<sha>' already exists`): pre-clean from `${src}` then retry that repo only.
- Worktree-add fails: another worktree at the target path; cleanup with `git worktree remove --force <wt>`.
- Push rejected on direct base: the script automatically falls back to PR. Confirm via the PR URL printed to stdout.

## Reference

- FLEET_SYNC sentinel: `template/.claude/hooks/no-revert-guard/` + `template/.claude/hooks/overeager-staging-guard/`.
- Wheelhouse sync-scaffolding: `socket-wheelhouse/scripts/sync-scaffolding/cli.mts`.
- Fleet-repo manifest: `lib/fleet-repos.txt`.
