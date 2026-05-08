# updating reference

Long-form details for the `updating` umbrella skill — phase scripts, exit-code semantics, and per-mode contracts. The orchestration story lives in [`SKILL.md`](SKILL.md).

## Phase scripts

### Phase 2 — npm packages

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

### Phase 3 — Validate lockstep manifest (if `lockstep.json` exists)

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

#### Lockstep exit-code semantics

| Exit | Meaning | Action |
|---|---|---|
| 0 | Manifest valid, no drift | Skip lockstep step in Phase 4 |
| 1 | Schema violation, missing file, or unreachable baseline | Stop and investigate via `scripts/lockstep-schema.mts` and the failing row's `local_*`/`upstream` fields. Do not auto-retry. |
| 2 | Drift detected | Phase 4 invokes `updating-lockstep`. Auto-bumps mechanical `version-pin` rows per `upgrade_policy`; everything else (`file-fork` / `feature-parity` / `spec-conformance` / `lang-parity` / `locked` version-pins) becomes advisory in the PR body. |

`locked` version-pin rows never auto-bump — they need a coordinated upstream change first (e.g., `temporal-rs` is `locked` because Node vendors it and bumping is gated on a Node bump landing first).

If `lockstep.json` does NOT exist, skip Phase 3 entirely.

### Phase 4 — Apply drift + non-lockstep submodules

**4a. lockstep drift** — if Phase 3 reported exit 2:

```bash
if [ "$LOCKSTEP_EXIT" = "2" ]; then
  # Invoke via the Skill tool / programmatic-claude flow used by the
  # weekly-update workflow. Standalone runs can do `/updating-lockstep`.
  echo "Invoking updating-lockstep for drift handling"
fi
```

`updating-lockstep` auto-bumps `version-pin` rows whose `upgrade_policy` is `track-latest` or `major-gate` (patch/minor only — majors → advisory), and emits an advisory block for everything else. Each auto-bumped row becomes its own atomic commit.

**4b. Non-lockstep submodules** — invoke each repo-specific `updating-*` sub-skill (e.g. `updating-node`, `updating-curl`) for submodules NOT claimed by a lockstep `version-pin` row. These sub-skills handle build inputs that aren't tracked in lockstep (cache-versions bumps, patch regeneration, etc.).

If no `.gitmodules` exists, skip 4b.

### Phase 5 — Workflow SHA pins

Resolve the default branch (per CLAUDE.md _Default branch fallback_), then compare:

```bash
BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/main;   then BASE=main;   fi
if [ -z "$BASE" ] && git show-ref --verify --quiet refs/remotes/origin/master; then BASE=master; fi
BASE="${BASE:-main}"

PINNED_SHA=$(grep -ohP '(?<=@)[0-9a-f]{40}' .github/workflows/_local-not-for-reuse-ci.yml 2>/dev/null | head -1)
DEFAULT_SHA=$(git rev-parse "origin/$BASE" 2>/dev/null || echo "")

if [ -n "$PINNED_SHA" ] && [ -n "$DEFAULT_SHA" ] && [ "$PINNED_SHA" != "$DEFAULT_SHA" ]; then
  echo "Workflow SHA pins are stale: $PINNED_SHA → $DEFAULT_SHA (origin/$BASE)"
  echo "Run the updating-workflows skill to cascade."
else
  echo "Workflow SHA pins are up to date (or no _local-not-for-reuse-*.yml pins in this repo)"
fi
```

### Phase 6 — Final validation (skip in CI)

```bash
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  echo "CI mode: skipping validation"
else
  pnpm run check --all
  pnpm test
  pnpm run build  # if this repo has a build step
fi
```

### Phase 7 — Report

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
2. Push to remote: `git push origin "$BASE"` (where `$BASE` is the default branch resolved in Phase 5 — `main` for most fleet repos, `master` for legacy ones)

**CI mode:**
1. Workflow will push branch and create PR
2. CI will run full build/test validation
3. Review PR when CI passes
```

## Mode contracts

### CI mode (`CI=true` or `GITHUB_ACTIONS`)

- Create atomic commits per category (npm, lockstep auto-bumps, submodule bumps).
- Skip Phase 6 build/test validation — CI validates separately.
- Workflow handles push and PR creation.

### Interactive mode (default)

- Run Phase 6 build + test before reporting "complete."
- Report validation results to the user.
- Direct push by the user once they've reviewed.

## Failure recovery

- **Phase 3 exit 1 (schema error):** stop. Read `scripts/lockstep-schema.mts` output and the offending row's `local_*` / `upstream` fields. Fix the manifest, then re-run.
- **Phase 4a (lockstep drift) commits but Phase 6 tests fail:** the per-row commits are atomic — `git revert <sha>` for the offending row, leave the others, file an advisory.
- **Phase 5 stale SHA pin:** run `/updating-workflows` to cascade the bump.
