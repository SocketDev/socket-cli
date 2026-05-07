---
name: updating
description: Umbrella update skill for a Socket fleet repo. Runs `pnpm run update` (npm), validates `lockstep.json` via `pnpm run lockstep` (if present), optionally bumps submodules, and checks workflow SHA pins. Use when asked to update dependencies, sync upstreams, or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Read, Edit, Grep, Glob, Bash(pnpm run:*), Bash(pnpm test:*), Bash(pnpm install:*), Bash(git:*), Bash(claude --version)
---

# updating

<task>
Update all dependencies for this repo: npm packages first, then the
lockstep-managed version pins (if `lockstep.json` exists), then any other
submodules tracked via `.gitmodules`, and finally verify workflow
SHA pins are current. Validate with the full check/test suite before
committing. The sub-skill delegation mirrors the canonical
socket-registry `updating` skill; uncomment the phases that apply to
this repo and delete those that don't.
</task>

<context>
**What is this?**
The umbrella update skill. Runs `pnpm run update` for npm deps, then
adapts to what the repo has:

**Update Targets:**
- **npm packages** — via `pnpm run update` (every Socket repo has this script)
- **lockstep-managed upstreams** — via `pnpm run lockstep` when `lockstep.json` exists
  (manifest-managed submodule pins + advisory drift on file-fork /
  feature-parity / spec-conformance / lang-parity rows)
- **Other submodules** — via repo-specific `updating-*` sub-skills
  when `.gitmodules` has entries not claimed by lockstep version-pin rows
- **Workflow SHA pins** — check `_local-not-for-reuse-*.yml` against
  `origin/main`; run the `updating-workflows` skill when stale

**Key files this skill consults:**
- `lockstep.json` — if present, drives version-pin bumps and surfaces drift
- `.gitmodules` — listed submodules; lockstep's `version-pin` rows take precedence
- `.github/workflows/_local-not-for-reuse-*.yml` — SHA pin sources
- `package.json` — `pnpm run update` script

Sub-skills are invoked only when applicable — this umbrella reads repo
state first to discover what to run.
</context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation (CI validates separately)
- Workflow handles push and PR creation

**Interactive Mode** (default):
- Validate updates with build/tests before proceeding
- Report validation results to user

**Actions:**
- Update npm packages
- Apply lockstep-driven bumps (if `lockstep.json` present)
- Bump remaining submodules (if any)
- Create atomic commits per category
- Report summary of changes
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

Check clean working directory, detect CI mode (`CI=true` or
`GITHUB_ACTIONS`), verify submodules initialized (if any).

---

### Phase 2: Update npm Packages

```bash
pnpm run update

if [ -n "$(git status --porcelain)" ]; then
  git add pnpm-lock.yaml package.json */package.json
  git commit -m "chore: update npm dependencies

Updated npm packages via pnpm run update."
  echo "npm packages updated"
else
  echo "npm packages already up to date"
fi
```

---

### Phase 3: Validate lockstep manifest (if applicable)

If `lockstep.json` exists at repo root, run the harness in read-only mode
to classify drift before acting on it:

```bash
if [ -f lockstep.json ]; then
  pnpm run lockstep
  LOCKSTEP_EXIT=$?

  case $LOCKSTEP_EXIT in
    0) echo "✓ lockstep clean — manifest valid, no drift; skip Phase 4 lockstep step" ;;
    1) echo "✗ lockstep schema/structural error — stopping"; exit 1 ;;
    2) echo "⚠ lockstep drift — Phase 4 will invoke updating-lockstep to act" ;;
  esac
fi
```

Exit code semantics:
- **0** — manifest valid, no drift; nothing for `updating-lockstep` to do.
- **1** — schema violation, missing file, or unreachable baseline. Stop
  and investigate via `scripts/lockstep-schema.mts` and the failing row's
  `local_*`/`upstream` fields. Do not auto-retry.
- **2** — drift detected. Phase 4 invokes the `updating-lockstep` skill,
  which auto-bumps mechanical `version-pin` rows (per `upgrade_policy`)
  and surfaces everything else (`file-fork` / `feature-parity` /
  `spec-conformance` / `lang-parity` / `locked` version-pins) as
  advisory notes for the PR body. Drift on `locked` rows never
  auto-bumps — they need a coordinated upstream change first (e.g.,
  `temporal-rs` is `locked` because Node vendors it and bumping is
  gated on a Node bump landing first).

If `lockstep.json` does NOT exist, skip this phase.

---

### Phase 4: Apply lockstep drift + update other submodules (if applicable)

**4a. lockstep drift** — if Phase 3 reported exit 2 (drift), invoke the
`updating-lockstep` skill. It auto-bumps `version-pin` rows whose
`upgrade_policy` is `track-latest` or `major-gate` (patch/minor only,
majors → advisory), and emits an advisory block for everything else.
Each auto-bumped row becomes its own atomic commit.

```bash
if [ "$LOCKSTEP_EXIT" = "2" ]; then
  # Invoke via the Skill tool / programmatic-claude flow used by the
  # weekly-update workflow. Standalone runs can do `/updating-lockstep`.
  echo "Invoking updating-lockstep for drift handling"
fi
```

**4b. Non-lockstep submodules** — invoke each `updating-*` sub-skill this
repo defines (e.g., `updating-node`, `updating-curl`) for submodules
NOT claimed by a lockstep `version-pin` row. These sub-skills know about
build inputs that aren't tracked in lockstep (cache-versions bumps,
patch regeneration, etc.).

If no `.gitmodules` exists, skip 4b.

---

### Phase 5: Check Workflow SHA Pins

Inspect `_local-not-for-reuse-*.yml` files for their pinned SHA and
compare against `origin/main`:

```bash
PINNED_SHA=$(grep -ohP '(?<=@)[0-9a-f]{40}' .github/workflows/_local-not-for-reuse-ci.yml 2>/dev/null | head -1)
MAIN_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -n "$PINNED_SHA" ] && [ -n "$MAIN_SHA" ] && [ "$PINNED_SHA" != "$MAIN_SHA" ]; then
  echo "Workflow SHA pins are stale: $PINNED_SHA → $MAIN_SHA"
  echo "Run the updating-workflows skill to cascade."
else
  echo "Workflow SHA pins are up to date (or no _local-not-for-reuse-*.yml pins in this repo)"
fi
```

---

### Phase 6: Final Validation (skip in CI)

```bash
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: skipping validation"
else
  pnpm run check --all
  pnpm test
  pnpm run build  # if this repo has a build step
fi
```

---

### Phase 7: Report Summary

```
## Update Complete

### Updates Applied:

| Category           | Status                               |
|--------------------|--------------------------------------|
| npm packages       | Updated / Up to date                 |
| lockstep manifest  | <ok>/<total> ok, <drift> drift, <error> error (exit <code>) — or n/a |
| Other submodules   | K bumped — or n/a                    |
| Workflow SHA pins  | Up to date / Stale                   |

### Commits Created:
- [list commits, if any]

### Validation:
- Build: SUCCESS / SKIPPED (CI mode)
- Tests: PASS / SKIPPED (CI mode)

### Next Steps:
**Interactive mode:**
1. Review changes: `git log --oneline -N`
2. Push to remote: `git push origin main`

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
3. Review PR when CI passes
```

</instructions>

## Success Criteria

- All npm packages checked for updates
- lockstep manifest validated (when present); schema/structural errors block
- Full build and tests pass (interactive mode)
- Summary report generated

## Context

This skill is useful for:

- Weekly maintenance (automated via `weekly-update.yml`)
- Security patch rollout
- Pre-release preparation

**Safety:** Updates are validated before committing. Schema errors
(lockstep exit 1) stop the process; drift (lockstep exit 2) is advisory
and does not block.
