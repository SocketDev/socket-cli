---
name: updating
description: Umbrella update skill for a Socket fleet repo. Runs `pnpm run update` (npm), validates `lockstep.json` via `pnpm run lockstep` (if present), optionally bumps submodules, checks workflow SHA pins, resolves open Dependabot security alerts, refreshes the README coverage badge when applicable, and audits GitHub repo + Actions settings drift via `scripts/lint-github-settings.mts`. Use when asked to update dependencies, sync upstreams, fix security advisories, refresh coverage, or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Read, Edit, Grep, Glob, Bash(pnpm run:*), Bash(pnpm test:*), Bash(pnpm install:*), Bash(git:*), Bash(claude --version)
---

# updating

Umbrella update skill. Runs `pnpm run update` for npm deps, then adapts to whatever the repo has: lockstep manifest, submodules, workflow SHA pins. Validates with check/test before reporting done.

## When to use

- Weekly maintenance (the `weekly-update.yml` workflow calls this skill).
- Security patch rollout.
- Pre-release preparation.

## Update targets

- **npm packages**: `pnpm run update` (every fleet repo has this script).
- **lockstep-managed upstreams**: `pnpm run lockstep` when `lockstep.json` exists. Mechanical `version-pin` bumps auto-apply; `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows surface as advisory.
- **Other submodules**: repo-specific `updating-*` sub-skills handle `.gitmodules` entries not claimed by a lockstep `version-pin` row.
- **Workflow SHA pins**: `_local-not-for-reuse-*.yml` SHAs against the remote's default branch (per CLAUDE.md _Default branch fallback_); run `/updating-workflows` when stale.
- **Security advisories**: open GitHub Dependabot alerts via `/update-security`. Direct deps bumped via `pnpm update`; transitives pinned via `pnpm.overrides`; unfixable advisories dismissed with documented reasons. Honors the 7-day soak gate.
- **Coverage badge**: when a coverage script exists (`cover` / `coverage` / `test:cover`), `/update-coverage` runs the script and rewrites the README badge to match. Repos without a coverage script skip silently.
- **GitHub settings drift**: `scripts/lint-github-settings.mts --force --json` audits repo + Actions settings against the fleet baseline (custom properties, feature flags, merge policy, branch protection, required apps like `cursor` / `claude` / `socket-security`). Read-only by default; fixes are surfaced as URLs the operator clicks through (`--fix` is gated on `repo:admin`, not auto-applied in the umbrella). Skipped under `CI=true` (the underlying script's local-only design).

This umbrella reads repo state first to discover what applies. Sub-skills are only invoked when relevant.

## Phases

| #   | Phase                | Outcome                                                                                                                                                                                                                                                                                 |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Validate environment | Clean tree, detect CI mode (`CI=true` / `GITHUB_ACTIONS`), submodules initialized.                                                                                                                                                                                                      |
| 2   | npm packages         | `pnpm run update` → atomic commit if anything moved.                                                                                                                                                                                                                                    |
| 3   | Validate lockstep    | If `lockstep.json` exists: `pnpm run lockstep`. Exit 0 = clean, 1 = stop, 2 = drift (handled in Phase 4).                                                                                                                                                                               |
| 4   | Apply drift          | 4a: lockstep auto-bumps (one commit per row). 4b: repo-specific `updating-*` sub-skills for non-lockstep submodules.                                                                                                                                                                    |
| 5   | Security advisories  | If `gh api .../dependabot/alerts?state=open` returns any rows, invoke `/update-security` (the `updating-security` sub-skill). Atomic commit per alert.                                                                                                                                  |
| 6   | Workflow SHA pins    | Compare pinned SHAs against `origin/$BASE`; report stale → `/updating-workflows`.                                                                                                                                                                                                       |
| 7   | Coverage badge       | If the repo declares a coverage script (`cover` / `coverage` / `test:cover`), invoke `/update-coverage` to refresh the README badge. Atomic commit if the percentage moved.                                                                                                             |
| 8   | GH settings drift    | Skipped under `CI=true`. Otherwise: `node scripts/lint-github-settings.mts --force --json` and surface findings (repo-settings drift, missing apps (cursor/claude/socket-security/etc), custom-property/visibility mismatches). Read-only; operator follows the fixUrl in each finding. |
| 9   | Final validation     | Interactive only: `pnpm run check --all && pnpm test && pnpm run build`. CI skips (validated separately).                                                                                                                                                                               |
| 10  | Report               | Per-category summary: npm / lockstep / submodules / security / SHA pins / coverage / settings drift / validation / next steps.                                                                                                                                                          |

Full bash, exit-code tables, mode contracts, and failure recovery in [`reference.md`](reference.md).

## Hard requirements

- **Clean tree on entry**: no uncommitted changes.
- **Atomic commits per category**: npm in one commit, each lockstep auto-bump in its own commit, each submodule bump in its own commit.
- **Conventional Commits** per CLAUDE.md.
- **Default-branch fallback**: never hard-code `main` or `master` in scripts.

## Success criteria

- All npm packages checked.
- Lockstep manifest validated (when present); schema errors block.
- Open Dependabot alerts either fixed, awaiting-soak, or dismissed with a documented reason.
- Full check + tests pass (interactive mode).
- Summary report printed.

**Safety:** updates are validated before committing. Schema errors (lockstep exit 1) stop the process; drift (exit 2) is advisory and does not block. Security-advisory fixes never `--force` push. Per-alert commits go through the normal push-or-PR flow.
