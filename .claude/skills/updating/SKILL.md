---
name: updating
description: Umbrella update skill for a Socket fleet repo. Runs `pnpm run update` (npm), validates `lockstep.json` via `pnpm run lockstep` (if present), optionally bumps submodules, checks workflow SHA pins, resolves open Dependabot security alerts, refreshes the README coverage badge when applicable, and audits GitHub repo + Actions settings drift via `scripts/lint-github-settings.mts`. Use when asked to update dependencies, sync upstreams, fix security advisories, refresh coverage, or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Read, Edit, Grep, Glob, Bash(pnpm run:*), Bash(pnpm test:*), Bash(pnpm install:*), Bash(git:*), Bash(claude --version)
model: claude-haiku-4-5
context: fork
---

# updating

Umbrella update skill. Runs `pnpm run update` for npm deps, then adapts to whatever the repo has: lockstep manifest, submodules, workflow SHA pins. Validates with check/test before reporting done.

## When to use

- Weekly maintenance (the `weekly-update.yml` workflow calls this skill).
- Security patch rollout.
- Pre-release preparation.

## Update targets

- **npm packages**: `pnpm run update` (every fleet repo has this script). If the diff bumps `engines.pnpm`, `packageManager`, or `engines.npm`, see **"When the bump includes pnpm or npm"** below.
- **lockstep-managed upstreams**: `pnpm run lockstep` when `lockstep.json` exists. Mechanical `version-pin` bumps auto-apply; `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows surface as advisory.
- **Other submodules**: repo-specific `updating-*` sub-skills handle `.gitmodules` entries not claimed by a lockstep `version-pin` row.
- **Workflow SHA pins**: `_local-not-for-reuse-*.yml` SHAs against the remote's default branch (per CLAUDE.md _Default branch fallback_); run `/updating-workflows` when stale.
- **Security advisories**: open GitHub Dependabot alerts via `/update-security`. Direct deps bumped via `pnpm update`; transitives pinned via `pnpm.overrides`; unfixable advisories dismissed with documented reasons. Honors the 7-day soak gate.
- **Coverage badge**: when a coverage script exists (`cover` / `coverage` / `test:cover`), `/update-coverage` runs the script and rewrites the README badge to match. Repos without a coverage script skip silently.
- **GitHub settings drift**: `scripts/lint-github-settings.mts --force --json` audits repo + Actions settings against the fleet baseline (custom properties, feature flags, merge policy, branch protection, required apps like `cursor` / `claude` / `socket-security`). Read-only by default; fixes are surfaced as URLs the operator clicks through (`--fix` is gated on `repo:admin`, not auto-applied in the umbrella). Skipped under `CI=true` (the underlying script's local-only design).

This umbrella reads repo state first to discover what applies. Sub-skills are only invoked when relevant.

## When the bump includes pnpm or npm

A bump to `engines.pnpm`, `packageManager: "pnpm@<ver>"`, or `engines.npm` in a fleet repo has a **transitive blast radius**: the socket-registry shared `setup-and-install` GHA action installs pnpm from `external-tools.json` at a specific version; if that version doesn't match the fleet repo's new `packageManager` pin, every CI job fails the version check before tests run.

The fix order is fixed — **don't try to land the fleet-repo bump first**:

1. **Defer to socket-registry's `updating-workflows` skill** (lives at `socket-registry/.claude/skills/updating-workflows/SKILL.md`). That skill drives the Layer 1 → 2a → 2b → 3 → 4 cascade in socket-registry, ending at a **Layer 3 merge SHA** known as the **propagation SHA**. The skill's external-tools.json bump bundles the new pnpm version with its 7-platform SRI integrity values.

2. **Capture the propagation SHA** from step 1. Every fleet-repo `uses: socket-registry/.github/{workflows,actions}/...@<sha>` ref bumps to it.

3. **Update wheelhouse template** in the same wave: `template/package.json` `engines.pnpm` / `engines.npm` / `packageManager` + `template/pnpm-workspace.yaml` `allowBuilds` entries for any new transitive build-scripts the bumped pnpm enforces (`pnpm@11.4` added `[ERR_PNPM_IGNORED_BUILDS]` as hard exit, so `esbuild` and friends need explicit allowlisting).

4. **Cascade fleet repos** atomically: each downstream socket-\* repo gets the new pnpm pin AND the new propagation SHA in the same cascade commit. Without atomicity, you get the failure mode we hit on 2026-05-28: fleet repo bumps to pnpm@11.4, CI fails because the installed pnpm (11.3 via old setup-action) refuses the pin.

Why reference, not duplicate: the cascade procedure is fleet-canonical knowledge owned by socket-registry. Duplicating it into wheelhouse means two copies that drift. The wheelhouse `updating` skill encodes "when to run the registry cascade and how to consume its output", not the cascade itself.

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
