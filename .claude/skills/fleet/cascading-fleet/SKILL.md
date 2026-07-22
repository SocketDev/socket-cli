---
name: cascading-fleet
description: Propagate a wheelhouse template change across fleet repos with worktrees, push/PR fallback, and cleanup.
user-invocable: true
allowed-tools: Bash(git fetch:*), Bash(git worktree:*), Bash(git branch:*), Bash(git status:*), Bash(git rev-list:*), Bash(git symbolic-ref:*), Bash(git show-ref:*), Bash(git push:*), Bash(git commit:*), Bash(git add:*), Bash(git log:*), Bash(node:*), Bash(gh pr create:*), Bash(gh repo view:*), Read, Bash(bash:*), Bash(chmod:*), Bash(cd:*), Bash(printf:*), Bash(echo:*), Bash(tee:*), Bash(tail:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
---

# cascading-fleet

The fleet runs on `chore(wheelhouse): cascade template@<sha>` commits. Every wheelhouse template change has to land in every fleet repo to take effect. This skill packages the operation so it isn't recreated ad-hoc per session.

🚨 **This is mechanical work, not a thinking task.** Run the canonical operation, commit, push. Don't analyze each modified file in the cascade, don't design alternatives, don't write multi-paragraph rationale — the wheelhouse template is the source of truth and the sync runner decides what changes. If a repo's cascade refuses to apply (lockfile policy reject, soak window, broken hook from a stale install), bump the immediate blocker (soak-exclude entry, lockfile rebuild) or defer the repo and report it — don't reason through a multi-step manual reproduction of what the sync runner already does. Cheap/fast model settings are the right default; reserve heavier reasoning for genuine design work.

## When to use

- A wheelhouse `template/` SHA needs to propagate to every fleet repo.
- Batching multiple template SHAs into one wave.

Tool-version bumps (pnpm, zizmor, sfw, …) route through the wheelhouse-owned
<!-- socket-lint: allow cross-repo -->
pipeline (`node scripts/repo/pipeline.mts`, run FROM the wheelhouse: bump →
reconcile → CI-green gate → propagate); this skill then carries the resulting
template change fleet-wide like any other.

Never use this skill while another cascade is in flight (each cascade creates a `chore/wheelhouse-<sha>` branch per repo; concurrent runs collide).

## The cascade

Propagates a `socket-wheelhouse/template/` SHA to every fleet repo. The flow:

1. For each fleet repo:
2. Worktree off `origin/<default-branch>` on a fresh `chore/wheelhouse-<sha>` branch.
3. Run `socket-wheelhouse/scripts/repo/sync-scaffolding/cli.mts --target <wt> --fix`.
4. If the cascade modified anything: surgical-stage with `FLEET_SYNC=1 git add --update`, commit `chore(wheelhouse): cascade template@<sha>`, push direct to base.
5. If direct push is rejected: push the branch, open a PR.
6. Clean up the worktree + the temp branch.

The `FLEET_SYNC=1` sentinel is recognized by the wheelhouse `no-revert-guard` + `overeager-staging-guard` hooks. It allowlists exactly: `git commit --no-verify` whose message starts with `chore(wheelhouse): cascade template@`, `git push --no-verify`, and `git add -A`/`-u`/`.`. Nothing else.

🚨 **Dogfood from a place of passing locally.** Before any dogfood cascade run the local-green gate IN ORDER: `pnpm run update` → `pnpm i` → `pnpm run fix --all` → `pnpm run check --all` → `pnpm run test` (or `pnpm run cover`); if green, commit (and fix + commit), THEN dogfood. `pnpm run update` runs FIRST so pending catalog / tool drift resolves in its own commit and does not ride the feature dogfood. Canonical reference + rationale: `docs/agents.md/repo/fleet-sync-and-release-flow.md` (stage b, DOGFOOD).

## How to invoke

```bash
# Propagate a wheelhouse template SHA fleet-wide
node .claude/skills/fleet/cascading-fleet/lib/cascade-template.mts <template-sha>
```

The script reads the fleet-repo list from `lib/fleet-repos.txt` (single source of truth), iterates, and writes a per-repo result line to stdout. Output also tees to `/tmp/cascade-<sha>.log` for post-hoc inspection.

## Post-cascade: reconcile lockfiles (in parallel)

🚨 A cascade that changes the catalog (`pnpm-workspace.yaml`), `packageManager`, or dep overrides lands a **lockfile-less** commit downstream — the worktree's `pnpm-lock.yaml` regenerates locally but is excluded from the cascade commit. Downstream CI runs `pnpm install --frozen-lockfile`, so a stale lockfile **red-lines every consumer**. The cascade is not done until each affected repo's lockfile is reconciled.

This is a parallel fleet operation, so it is **a Workflow, not a shell loop** (`for r in …; do … & done; wait` races — multiple instances land on one repo and orphan worktrees). Two layered surfaces, executable-first:

1. **The per-repo executable (the law):** `lib/reconcile-lockfiles.mts` — worktrees off the repo default branch, runs `pnpm install` (repo-pinned pnpm) to regenerate the lockfile against the cascaded catalog, and IF it changed commits `chore(wheelhouse): reconcile pnpm-lock.yaml after cascade` (FLEET_SYNC sentinel) + pushes, then force-removes its worktree. Idempotent — a repo already current reports `noop:lockfile-current` and pushes nothing. Scope to one repo with `--skip <all-others>`.
2. **The fan-out (the orchestrator):** the saved Workflow `reconcile-fleet-lockfiles` (`.claude/workflows/reconcile-fleet-lockfiles.js`) runs surface 1 once per repo in parallel — bounded concurrency, one task per repo, structured results, no leaked PIDs. Run it after a catalog cascade:

```
Workflow({ name: 'reconcile-fleet-lockfiles' })                 # whole roster (already-current repos no-op)
Workflow({ name: 'reconcile-fleet-lockfiles', args: ['socket-lib', 'sdxgen'] })   # only the cascade's targets
```

Because surface 1 is idempotent, running the whole roster is safe; pass `args` — a repo-name array, or `{ only, skip }` — to narrow to just the repos a cascade touched. Local/experimental workflow scripts save to `~/.claude/workflows/` — the repo's `.claude/workflows/` is fleet-owned and delete-and-replace mirrored.

## Worktree cleanup: the branch-cleanup bug

A subtle gotcha: the script's pre-clean step (`git branch -D <branch>`) MUST run from `${src}` (the source repo), not from `/tmp` or the worktree directory. If the loop crashes mid-iteration before `cd`-ing into the worktree, a stale `chore/wheelhouse-<sha>` branch can be left behind. The provided script handles this. If you write a one-off cascade, make sure your cleanup runs from the right cwd.

## Soak time before catalog cascades

If the wheelhouse template change includes a `@socketsecurity/lib` catalog bump in `pnpm-workspace.yaml`, wait at least 5 minutes after the npm publish completes before starting the cascade. The cascade's `pnpm install` step will 404 if the new version isn't yet visible on the npm CDN.

## Stop conditions

- Branch already exists in a fleet repo (`fatal: a branch named 'chore/wheelhouse-<sha>' already exists`): pre-clean from `${src}` then retry that repo only.
- Worktree-add fails: another worktree at the target path; cleanup with `git worktree remove --force <wt>`.
- Push rejected on direct base: the script automatically falls back to PR. Confirm via the PR URL printed to stdout.

## Recovery playbook — the judgment exceptions a plain run can't decide

The cascade script (`lib/cascade-template.mts`) is deterministic — it `--no-verify` commits + pushes per repo and always cleans up its worktree (verified: the success path, every early-exit, and the PR-fallback all run `worktree remove --force` + `branch -D`). What it CANNOT decide are these three situations. Each needs a human/agent call, not a script branch:

1. **Dirty downstream checkout** (`<repo>: working tree dirty — manual sync needed`). The script skips dirty checkouts so it never sweeps another agent's work. To unblock:
   - If the dirt is **mechanical sync/format drift** (oxlintrc array-collapse, jsdoc reflow, `.gitattributes`/CLAUDE.md fleet-block) — commit it as `chore(wheelhouse): cascade template@<sha>` (or `style:` for pure reflow). Safe; it IS cascade output.
   - If the dirt is **hand-authored feature work** in `src/` touched recently — leave it; that's a live session. Re-run the cascade after they land.
   - A `pnpm-lock.yaml` left dirty by a pre-commit `pnpm install` is regenerable: `git checkout -- pnpm-lock.yaml` before rebase/push.

2. **Stranded local commits** (local `main` diverged with un-pushed `chore(wheelhouse): cascade …` commits that origin already superseded). Confirm with `git branch -r --contains <sha>` (empty = local-only) and `git log --oneline HEAD..origin/main` (origin has newer cascades). If origin already has the work in canonical form, `git reset --hard origin/main` (needs `Allow reset bypass`) — nothing real is lost. Otherwise rebase the genuine local-unique commits on top.

3. <!-- socket-lint: allow cross-repo --> **Soak-bypassing a tool bump** (pnpm/zizmor/sfw newer than the 7-day `minimumReleaseAge`). The auto-updater (`scripts/repo/update-external-tools.mts`, dry-run by default; `--apply` flushes) skips fresh releases. To bump anyway: hand-pin `external-tools.json` (version + every platform asset + recomputed sha256 integrity from the upstream GitHub release; npm-tarball platforms use npm `dist.integrity`), needs `Allow soak-time bypass` (alias: `Allow minimumReleaseAge bypass`). Then run the wheelhouse tool-pin pipeline (`node scripts/repo/pipeline.mts`, from the wheelhouse) to bump, reconcile, and gate on CI-green, then commit the `external-tools.json` bump and cascade it fleet-wide with this skill. **Why:** a `packageManager` pin that drifts from the CI runner's pnpm red-lines fleet CI, and a pnpm bump can surface a previously-dormant `allowBuilds` placeholder that then trips `ERR_PNPM_IGNORED_BUILDS` — bump the tool and reconcile the build allowlist in the same wave.

## Reference

- FLEET_SYNC sentinel: `template/.claude/hooks/fleet/no-revert-guard/` + `template/.claude/hooks/fleet/overeager-staging-guard/`.
- Wheelhouse sync-scaffolding: `socket-wheelhouse/scripts/repo/sync-scaffolding/cli.mts`.
- Fleet-repo manifest: `lib/fleet-repos.txt`.
- Tool-pin propagation: the wheelhouse pipeline (`socket-wheelhouse/scripts/repo/pipeline.mts` — bump → reconcile → CI-green gate → propagate); this skill then carries the template change fleet-wide.

## Handoff

For a narrow, named cascade category, use [syncing-fleet](../../repo/syncing-fleet/SKILL.md)
instead of a full template wave.
