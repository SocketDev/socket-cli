---
name: updating
description: Umbrella update skill for a Socket fleet repo. Runs `pnpm run update` (npm), validates `lockstep.json` via `pnpm run lockstep` (if present), optionally bumps submodules, checks workflow SHA pins, resolves open Dependabot security alerts, refreshes the README coverage badge when applicable, and audits GitHub repo + Actions settings drift via `scripts/lint-github-settings.mts`. Discovers what applies via a parallel read-only Workflow sweep, then applies per-category drift (per-row lockstep bumps, per-alert security) as pipeline fan-out. Use when asked to update dependencies, sync upstreams, fix security advisories, refresh coverage, or prepare for a release.
user-invocable: true
allowed-tools: Workflow, Skill, Read, Edit, Grep, Glob, Bash(pnpm run:*), Bash(pnpm test:*), Bash(pnpm install:*), Bash(git:*), Bash(claude --version)
model: claude-haiku-4-5
context: fork
---

# updating

Umbrella update skill. Runs `pnpm run update` for npm deps, then adapts to whatever the repo has: lockstep manifest, submodules, workflow SHA pins. A `Workflow` does the discovery (parallel read-only probes for what applies) and the per-category drift apply (per-row lockstep bumps, per-alert security run as pipelines); the ordered phases that must stay sequential (npm before lockstep, validate before push) run inline around it. Validates with check/test before reporting done.

## When to use

- Weekly maintenance (the `weekly-update.yml` workflow calls this skill).
- Security patch rollout.
- Pre-release preparation.

## Update targets

- **npm packages**: `pnpm run update` (every fleet repo has this script). If the diff bumps `engines.pnpm`, `packageManager`, or `engines.npm`, see **"When the bump includes pnpm or npm"** below.
- **lockstep-managed upstreams**: `pnpm run lockstep` when `lockstep.json` exists. Mechanical `version-pin` bumps auto-apply; `file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` rows surface as advisory.
- **Other submodules**: repo-specific `updating-*` sub-skills handle `.gitmodules` entries not claimed by a lockstep `version-pin` row.
- **Workflow SHA pins**: `_local-not-for-reuse-*.yml` SHAs against the remote's default branch (per CLAUDE.md _Default branch fallback_); reports drift for manual repin.
- **Security advisories**: open GitHub Dependabot alerts via `/update-security`. Direct deps bumped via `pnpm update`; transitives pinned via `pnpm.overrides`; unfixable advisories dismissed with documented reasons. Honors the 7-day soak gate.
- **Coverage badge**: when a coverage script exists (`cover` / `coverage` / `test:cover`), `/update-coverage` runs the script and rewrites the README badge to match. Repos without a coverage script skip silently.
- **Model pricing**: `/update-pricing` re-sources per-model token prices from the vendor pricing page and restamps `scripts/fleet/constants/model-pricing.json` + the routing-doc snapshot. This is what anchors pricing freshness to the weekly cadence — the snapshot is "as fresh as the last weekly run", not a guessed timer. Repos without the pricing data skip silently.
- **GitHub settings drift**: `scripts/fleet/lint-github-settings.mts --force --json` audits repo + Actions settings against the fleet baseline (custom properties, feature flags, merge policy, branch protection, required apps like `cursor` / `claude` / `socket-security`). Read-only by default; fixes are surfaced as URLs the operator clicks through (`--fix` is gated on `repo:admin`, not auto-applied in the umbrella). Skipped under `CI=true` (the underlying script's local-only design).

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

| #   | Phase                | Outcome                                                                                                                                                                                                                                                                                       |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Validate environment | Clean tree, detect CI mode (`CI=true` / `GITHUB_ACTIONS`), submodules initialized.                                                                                                                                                                                                            |
| 2   | npm packages         | `pnpm run update` → atomic commit if anything moved.                                                                                                                                                                                                                                          |
| 3   | Dedup deps           | `/deduping-dependencies` — promote newly-clearable `@socketregistry` drop-ins, collapse same-major duplicates, and (for bundled outputs) prefer the ESM major. Read-only scan first; applies fleet-canonical `overrides:` (+ a `pnpm patch` when a force-to-latest needs a compat shim) only after the format-vs-API decision tree + consumer-grep verify it's safe.                          |
| 4   | Validate lockstep    | If `lockstep.json` exists: `pnpm run lockstep`. Exit 0 = clean, 1 = stop, 2 = drift (handled in Phase 5).                                                                                                                                                                                     |
| 5   | Apply drift          | 5a: lockstep auto-bumps (one commit per row). 5b: repo-specific `updating-*` sub-skills for non-lockstep submodules.                                                                                                                                                                          |
| 6   | Security advisories  | If `gh api .../dependabot/alerts?state=open` returns any rows, invoke `/update-security` (the `updating-security` sub-skill). Atomic commit per alert.                                                                                                                                        |
| 7   | Workflow SHA pins    | Compare pinned SHAs against `origin/$BASE`; report drift for manual repin.                                                                                                                                                                                                             |
| 8   | Coverage badge       | If the repo declares a coverage script (`cover` / `coverage` / `test:cover`), invoke `/update-coverage` to refresh the README badge. Atomic commit if the percentage moved.                                                                                                                   |
| 9   | Model pricing        | If the repo carries `scripts/fleet/constants/model-pricing.json`, invoke `/update-pricing` to re-source per-model prices + restamp the snapshot. Atomic commit if a price moved. This is the refresh that keeps pricing freshness anchored to the weekly cadence.                            |
| 10  | GH settings drift    | Skipped under `CI=true`. Otherwise: `node scripts/fleet/lint-github-settings.mts --force --json` and surface findings (repo-settings drift, missing apps (cursor/claude/socket-security/etc), custom-property/visibility mismatches). Read-only; operator follows the fixUrl in each finding. |
| 11  | Final validation     | Interactive only: `pnpm run check --all && pnpm test && pnpm run build`. CI skips (validated separately).                                                                                                                                                                                     |
| 12  | Report               | Per-category summary: npm / dedup / lockstep / submodules / security / SHA pins / coverage / pricing / settings drift / validation / next steps.                                                                                                                                                      |

### What runs inline vs. in the `Workflow`

The phases have a hard ordering on the spine: env-check → npm bump → lockstep _validate_ must run in sequence inline, because each gates the next (a dirty tree blocks npm; npm changes feed lockstep). The fan-out lives in two places, and that's what the `Workflow` owns:

- **Discovery** (parallel barrier) — once the spine is clean, the deterministic probes (lockstep exit-2 drift, un-pinned/behind submodules, coverage-script presence, pending pricing) run in one shot via [`lib/discover.mts`](lib/discover.mts), which fans them out in parallel and returns a single `{ base, cwd, categories }` JSON object (each category `{ applies, actionable, items, blocked }`). Run it first — `node .claude/skills/fleet/updating/lib/discover.mts` — and only spend an `agent()` (`agentType: 'Explore'`) on the categories needing judgment (e.g. GitHub settings drift). A barrier here is justified — the apply step needs the full picture to order commits.
- **Apply** (pipelines) — the independent per-item work:
  - lockstep `version-pin` rows → `pipeline(rows, bumpRow, validateRow)`, one atomic commit per row.
  - Dependabot alerts → delegate to the `updating-security` sub-skill (itself now a per-alert pipeline). The umbrella passes the discovered alert list; don't re-implement its pipeline here.
  - coverage badge / settings drift → single linear ops, run inline after the pipelines (no fan-out).

Keep the umbrella's fan-out modest: it runs in CI under `model: claude-haiku-4-5` with the four-flag lockdown, and each `agent()` spends tokens. Discovery is a handful of probes, not a deep sweep. The heavy per-item loops (security alerts especially) belong to the sub-skills.

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
