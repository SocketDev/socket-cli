---
name: updating
description: Coordinates all dependency updates (npm packages and external tool checksums). Triggers when user asks to "update everything", "update dependencies", or prepare for a release.
user-invocable: true
allowed-tools: Task, Skill, Bash, Read, Grep, Glob, Edit
---

# updating

<task>
Your task is to update all dependencies in socket-cli: npm packages via `pnpm run update`, then sync external tool checksums, ensuring all builds and tests pass.
</task>

<context>
**What is this?**
socket-cli uses npm packages and external tools (opengrep, python, socket-patch, sfw, trivy, trufflehog) that need periodic updates for security patches, bug fixes, and new features.

**Existing Skills:**
- `updating-checksums` - Syncs SHA-256 checksums from GitHub releases to external-tools.json
- `quality-scan` - Comprehensive quality scanning and issue fixing

**Update Targets:**
1. **npm packages** - Updated via `pnpm run update`
2. **External tool checksums** - Updated via `updating-checksums` skill
</context>

<constraints>
**Requirements:**
- Start with clean working directory (no uncommitted changes)
- Target stable releases only (exclude -rc, -alpha, -beta tags)

**CI Mode** (detected via `CI=true` or `GITHUB_ACTIONS`):
- Create atomic commits, skip build validation (CI validates separately)
- Workflow handles push and PR creation

**Interactive Mode** (default):
- Validate each update with build/tests before proceeding
- Report validation results to user

**Actions:**
- Update npm packages and external tool checksums
- Create atomic commits for each update
- Report comprehensive summary of all changes
</constraints>

<instructions>

## Process

### Phase 1: Validate Environment

<action>
Check working directory is clean and detect CI mode:
</action>

```bash
# Detect CI mode
if [ "$CI" = "true" ] || [ -n "$GITHUB_ACTIONS" ]; then
  CI_MODE=true
  echo "Running in CI mode - will skip build validation"
else
  CI_MODE=false
  echo "Running in interactive mode - will validate builds"
fi

# Check working directory is clean
git status --porcelain
```

<validation>
- Working directory must be clean
- CI_MODE detected for subsequent phases
</validation>

---

### Phase 2: Update npm Packages

<action>
Run pnpm run update to update npm dependencies:
</action>

```bash
# Update npm packages
pnpm run update

# Check if there are changes
if [ -n "$(git status --porcelain pnpm-lock.yaml package.json packages/*/package.json)" ]; then
  git add pnpm-lock.yaml package.json packages/*/package.json
  git commit -m "chore: update npm dependencies

Updated npm packages via pnpm run update."
  echo "npm packages updated"
else
  echo "npm packages already up to date"
fi
```

---

### Phase 3: Update External Tool Checksums

<action>
Use the updating-checksums skill to sync SHA-256 checksums from GitHub releases:
</action>

```
Skill({ skill: "updating-checksums" })
```

Wait for skill completion before proceeding.

---

### Phase 4: Final Validation

<action>
Run full build and test suite (skip in CI mode):
</action>

```bash
if [ "$CI_MODE" = "true" ]; then
  echo "CI mode: Skipping final validation (CI will run builds/tests separately)"
  echo "Commits created - ready for push by CI workflow"
else
  echo "Interactive mode: Running full validation..."
  pnpm run fix --all
  pnpm run check --all
  pnpm test
fi
```

---

### Phase 5: Report Summary

<action>
Generate comprehensive update report:
</action>

```
## Update Complete

### Updates Applied:

| Category | Status |
|----------|--------|
| npm packages | Updated/Up to date |
| External tool checksums | Updated/Up to date |

### Commits Created:
- [list commits]

### Validation:
- Build: SUCCESS/SKIPPED (CI mode)
- Tests: PASS/SKIPPED (CI mode)

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
- External tool checksums synced
- Full build and tests pass (interactive mode)
- Comprehensive summary report generated

## Commands

This skill coordinates other skills:

- Uses `updating-checksums` skill for external tool checksums
- Direct pnpm commands for npm package updates

## Context

This skill is useful for:

- Weekly maintenance (automated via weekly-update.yml)
- Security patch rollout across all dependencies
- Pre-release preparation

**Safety:** Each update is validated independently. Failures stop the process.
