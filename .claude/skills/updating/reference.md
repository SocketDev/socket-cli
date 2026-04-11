# updating Reference Documentation

This document provides detailed information about dependency update procedures, external tool checksums, and troubleshooting for the socket-cli updating skill.

## Table of Contents

1. [Update Targets](#update-targets)
2. [npm Dependency Updates](#npm-dependency-updates)
3. [External Tool Checksums](#external-tool-checksums)
4. [Monorepo Structure](#monorepo-structure)
5. [Weekly Update Workflow](#weekly-update-workflow)
6. [Validation](#validation)
7. [Troubleshooting](#troubleshooting)

---

## Update Targets

### npm Packages

Updated via `pnpm run update` which runs `scripts/update.mjs`:

1. **taze** pass: `pnpm exec taze -r -w` (recursive, write mode across all packages)
2. **Socket packages** pass: `pnpm update @socketsecurity/* @socketregistry/* @socketbin/* --latest -r` (bypasses taze maturity period)
3. **Install**: `pnpm install` to update lock file

### External Tool Checksums

Updated via the `updating-checksums` skill which runs `packages/cli/scripts/sync-checksums.mjs`:

- Syncs SHA-256 checksums from GitHub releases to `packages/cli/bundle-tools.json`
- Only processes tools with `type: "github-release"`

---

## npm Dependency Updates

### How `pnpm run update` Works

```bash
# Phase 1: Update all dependencies via taze
pnpm exec taze -r -w

# Phase 2: Force-update Socket scoped packages (bypass maturity period)
pnpm update @socketsecurity/* @socketregistry/* @socketbin/* --latest -r

# Phase 3: Install
pnpm install
```

### Package Scopes

Socket packages are force-updated to latest regardless of taze maturity:
- `@socketsecurity/*` - Core Socket libraries
- `@socketregistry/*` - Socket registry packages
- `@socketbin/*` - Socket binary packages

### Files That Change

After update, these files may be modified:
- `package.json` (root)
- `packages/cli/package.json`
- `packages/build-infra/package.json`
- `packages/package-builder/package.json`
- `pnpm-lock.yaml`

---

## External Tool Checksums

### bundle-tools.json Structure

**Location:** `packages/cli/bundle-tools.json`

**Tool types:**

| Type | Tools | Checksum Source |
|------|-------|----------------|
| `github-release` | opengrep, python, socket-patch, sfw, trivy, trufflehog | SHA-256 from releases |
| `npm` | @coana-tech/cli, @cyclonedx/cdxgen, synp | SRI integrity hashes |
| `pypi` | socketsecurity | SRI integrity hashes |
| `github-source` | socket-basics | No checksums |

**JSON structure per tool:**

```json
{
  "description": "Tool description",
  "type": "github-release",
  "package": "tool-name",
  "version": "1.0.0",
  "repository": "owner/repo",
  "githubRelease": "v1.0.0",
  "checksums": {
    "filename-linux-amd64.tar.gz": "sha256hexstring",
    "filename-darwin-arm64.tar.gz": "sha256hexstring"
  }
}
```

### Sync Checksums Script

**Location:** `packages/cli/scripts/sync-checksums.mjs`

**Process:**
1. Reads `bundle-tools.json` for GitHub release tools
2. For each tool, tries to download `checksums.txt` from the release
3. If no checksums.txt, downloads each asset and computes SHA-256
4. Updates embedded checksums in `bundle-tools.json`

**Options:**
- `--tool=<name>` - Sync specific tool only
- `--force` - Force update even if unchanged
- `--dry-run` - Preview changes without writing

### When to Sync Checksums

- After manually updating tool versions in bundle-tools.json
- After new GitHub releases are published for any tool
- As part of the full update cycle (run after npm updates)

---

## Monorepo Structure

```
socket-cli/
├── packages/
│   ├── cli/              # Main Socket CLI application
│   ├── build-infra/      # Build infrastructure
│   └── package-builder/  # Package builder utility
├── scripts/
│   └── update.mjs        # Monorepo-aware dependency updater
└── pnpm-lock.yaml
```

### Package Dependencies

The monorepo uses pnpm workspaces. Updates are recursive (`-r` flag) to cover all packages.

---

## Weekly Update Workflow

**Location:** `.github/workflows/weekly-update.yml`
**Schedule:** Monday 9 AM UTC

### Pipeline

1. **check-updates** - Runs `pnpm outdated` to detect available updates
2. **apply-updates** - Creates branch `weekly-update-YYYYMMDD`, runs Claude Code with `/updating` skill, creates draft PR
3. **notify** - Reports status

### CI Mode Behavior

When `CI=true` or `GITHUB_ACTIONS` is set:
- Skip build/test validation (CI jobs validate separately)
- Create atomic commits for each logical update
- Workflow handles branch creation and PR

---

## Validation

### Post-Update Validation (Interactive Mode)

```bash
# Fix lint issues across all packages
pnpm run fix --all

# Run all checks (lint + type check)
pnpm run check --all

# Run tests
pnpm test
```

### CI Mode

Validation is skipped - CI pipeline runs builds and tests in separate jobs after the update PR is created.

---

## Troubleshooting

### taze Reports No Updates

**Symptom:** `pnpm run update` shows no changes when updates exist.

**Cause:** taze has a maturity period for new releases (typically 3 days).

**Solution:** Socket packages bypass taze maturity via direct `pnpm update --latest`. For other packages, wait for maturity period or manually update `package.json`.

### Checksum Sync Fails

**Symptom:** `sync-checksums.mjs` errors out.

**Possible causes:**
- GitHub API rate limiting: check with `gh api rate_limit --jq '.rate'`
- Release doesn't exist: verify with `gh release view <tag> --repo <owner/repo>`
- Network connectivity issues

### Lock File Conflicts

**Symptom:** `pnpm install` fails after update due to resolution conflicts.

**Solution:**
```bash
rm pnpm-lock.yaml
pnpm install
```

### Partial Update Failure

**Symptom:** taze phase succeeds but Socket package phase fails (or vice versa).

**Solution:**
- Check error messages for specific package failures
- Socket packages may have unpublished versions - verify with `npm view @socketsecurity/<pkg> versions`
- Commit successful updates, create separate issue for failures

### Weekly Update PR Has Conflicts

**Symptom:** Automated PR can't be merged due to conflicts.

**Solution:**
1. Check what changed on main since the update branch was created
2. Rebase the update branch or re-run the workflow
3. Manual resolution if conflicts are in lock file: regenerate with `pnpm install`
