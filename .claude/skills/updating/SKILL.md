---
name: updating
description: Umbrella update skill for a Socket fleet repo. Runs `pnpm run update` (npm), validates `lockstep.json` via `pnpm run lockstep` (if present), optionally bumps submodules, checks workflow SHA pins, and resolves open Dependabot security alerts. Use when asked to update dependencies, sync upstreams, fix security advisories, or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Read, Edit, Grep, Glob, Bash(pnpm run:*), Bash(pnpm test:*), Bash(pnpm install:*), Bash(git:*), Bash(claude --version)
---

# updating

Umbrella update skill. Runs `pnpm run update` for npm deps, then adapts to whatever the repo has — lockstep manifest, submodules, workflow SHA pins. Validates with check/test before reporting done.

## When to use

- Weekly maintenance (the `weekly-update.yml` workflow calls this skill).
- Security patch rollout.
- Pre-release preparation.

## Update targets

- **npm packages** — `pnpm run update` (every fleet repo has this script).
- **lockstep-managed upstreams** — `pnpm run lockstep` when `lockstep.json` exists. Mechanical `version-pin` bumps auto-apply; `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows surface as advisory.
- **Other submodules** — repo-specific `updating-*` sub-skills handle `.gitmodules` entries not claimed by a lockstep `version-pin` row.
- **Workflow SHA pins** — `_local-not-for-reuse-*.yml` SHAs against the remote's default branch (per CLAUDE.md _Default branch fallback_); run `/updating-workflows` when stale.
- **Security advisories** — open GitHub Dependabot alerts via `/update-security`. Direct deps bumped via `pnpm update`; transitives pinned via `pnpm.overrides`; unfixable advisories dismissed with documented reasons. Honors the 7-day soak gate.

This umbrella reads repo state first to discover what applies — sub-skills are only invoked when relevant.

## Phases

| #   | Phase                | Outcome                                                                                                              |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Validate environment | Clean tree, detect CI mode (`CI=true` / `GITHUB_ACTIONS`), submodules initialized.                                   |
| 2   | npm packages         | `pnpm run update` → atomic commit if anything moved.                                                                 |
| 3   | Validate lockstep    | If `lockstep.json` exists: `pnpm run lockstep`. Exit 0 = clean, 1 = stop, 2 = drift (handled in Phase 4).            |
| 4   | Apply drift          | 4a: lockstep auto-bumps (one commit per row). 4b: repo-specific `updating-*` sub-skills for non-lockstep submodules. |
| 5   | Security advisories  | If `gh api .../dependabot/alerts?state=open` returns any rows, invoke `/update-security` (the `updating-security` sub-skill). Atomic commit per alert. |
| 6   | Workflow SHA pins    | Compare pinned SHAs against `origin/$BASE`; report stale → `/updating-workflows`.                                    |
| 7   | Final validation     | Interactive only: `pnpm run check --all && pnpm test && pnpm run build`. CI skips (validated separately).            |
| 8   | Report               | Per-category summary: npm / lockstep / submodules / security / SHA pins / validation / next steps.                   |

Full bash, exit-code tables, mode contracts, and failure recovery in [`reference.md`](reference.md).

## Hard requirements

- **Clean tree on entry** — no uncommitted changes.
- **Atomic commits per category** — npm in one commit, each lockstep auto-bump in its own commit, each submodule bump in its own commit.
- **Conventional Commits** per CLAUDE.md.
- **Default-branch fallback** — never hard-code `main` or `master` in scripts.

## Success criteria

- All npm packages checked.
- Lockstep manifest validated (when present); schema errors block.
- Open Dependabot alerts either fixed, awaiting-soak, or dismissed with a documented reason.
- Full check + tests pass (interactive mode).
- Summary report printed.

**Safety:** updates are validated before committing. Schema errors (lockstep exit 1) stop the process; drift (exit 2) is advisory and does not block. Security-advisory fixes never `--force` push — per-alert commits go through the normal push-or-PR flow.
