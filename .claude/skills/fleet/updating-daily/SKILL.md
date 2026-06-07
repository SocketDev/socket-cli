---
name: updating-daily
description: Daily fleet-repo maintenance that promotes soak-cleared dependency exclusions. Runs check-soak-excludes-have-dates --fix to drop minimumReleaseAgeExclude entries whose 7-day soak has passed, then reconciles the lockfile. Sibling of updating-coverage / updating-security / updating-lockstep under the updating umbrella; the lightweight daily counterpart to the weekly /updating run.
user-invocable: true
allowed-tools: Read, Bash(node scripts/fleet/check/soak-excludes-have-dates.mts:*), Bash(pnpm install:*), Bash(git:*)
model: claude-haiku-4-5
context: fork
---

# updating-daily

The daily, cheap maintenance pass: promote dependency soak-exclusions that have cleared their 7-day `minimumReleaseAge` window. A soak-exclude is a temporary bypass; once the package is old enough to install normally, the bypass is dead weight and should come out. Invoked daily by `daily-update.yml` (which routes through the same socket-registry reusable as the weekly run, opening a PR), or directly via `/update-daily`.

## When to use

- The daily scheduled run (the workflow passes `updating-skill: updating-daily`).
- Any time you want to clear soaked exclusions from `pnpm-workspace.yaml`.

## What it does NOT do

- **npm version bumps.** That's the weekly `/updating` umbrella's job (taze, lockstep, submodules). Daily is soak-promotion only — small, predictable, safe to run unattended.
- **Add exclusions.** Adding a soak-bypass is the `Allow minimumReleaseAge bypass` flow, not this skill.
- **Touch repo-local non-exclude settings.** Only `minimumReleaseAgeExclude` entries are promoted; the rest of `pnpm-workspace.yaml` is untouched.

## Phases

| #   | Phase     | Outcome                                                                                                                                                               |
| --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Promote   | `node scripts/fleet/check/soak-excludes-have-dates.mts --fix` removes every entry whose `removable:` date has passed (the bullet + its `# published/removable` annotation). |
| 2   | Reconcile | If step 1 changed `pnpm-workspace.yaml`, run `pnpm install` so the lockfile matches the slimmed catalog/exclude set.                                                  |
| 3   | Report    | If nothing was promoted, exit cleanly with no diff — the workflow opens no PR. Otherwise the changed files (`pnpm-workspace.yaml` + `pnpm-lock.yaml`) become the PR.  |

## Run

```bash
node scripts/fleet/check/soak-excludes-have-dates.mts --fix
# then, only if pnpm-workspace.yaml changed:
pnpm install
```

`--fix` prints each promoted entry on stdout and is a no-op (clean exit, no
write) when nothing has soaked. A no-change run leaves the tree clean, so the
wrapping workflow opens no PR.

## Commit shape

The change is mechanical and needs no tracking: `chore(deps): promote soaked
exclusions`. List the promoted `pkg@ver` entries in the body. Cascade commits
and this daily promotion are exempt from the `prose` skill.
