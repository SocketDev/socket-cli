---
name: bump-coana
description: Bump @coana-tech/cli to a new version, update changelog, and create a PR. Use when user wants to upgrade Coana CLI, bump Coana version, or says "bump coana" with a version number.
allowed-tools: Read, Edit, Write, Bash, Glob
user-invocable: true
---

# Bump Coana CLI Version

Automates the process of upgrading the @coana-tech/cli dependency to a new version, including package.json updates, changelog entry, and PR creation.

## Input

- **Version**: The Coana version to upgrade to (e.g., `14.12.173`)
- Passed via `$ARGUMENTS` (e.g., `/bump-coana 14.12.173`)

If no version is provided, ask the user for the Coana version to upgrade to.

## Workflow

### Step 1: Parse and Validate Input

Extract the version number from `$ARGUMENTS`:

```bash
COANA_VERSION="$ARGUMENTS"

# Validate version format (should be semver-like: X.Y.Z)
if [[ ! "$COANA_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: Invalid version format. Expected X.Y.Z (e.g., 14.12.173)"
  exit 1
fi
```

### Step 2: Update package.json

1. Read `package.json` in the repository root.
2. Find the current `@coana-tech/cli` version in `devDependencies` and note it as `CURRENT_VERSION`.
3. Update `@coana-tech/cli` to the new version.
4. Bump the patch version of the package (e.g., `1.1.59` → `1.1.60`).
5. Write the updated `package.json`.

**Values to extract**:
- `CURRENT_VERSION`: The old @coana-tech/cli version (for PR body)
- `NEW_PKG_VERSION`: The bumped package.json version (for changelog)

### Step 3: Update CHANGELOG.md

1. Read `CHANGELOG.md` in the repository root.
2. Add a new version entry after the header section (which ends with "The format is based on...").
3. Use today's date in `YYYY-MM-DD` format.

**Entry format**:
```markdown
## [NEW_PKG_VERSION](https://github.com/SocketDev/socket-cli/releases/tag/vNEW_PKG_VERSION) - YYYY-MM-DD

### Changed
- Updated the Coana CLI to v `COANA_VERSION`.

```

**Note**: Include a blank line after the entry.

### Step 4: Update Lock File

```bash
pnpm install
```

This updates `pnpm-lock.yaml` with the new dependency version.

### Step 5: Create Branch and Commit

```bash
# Create branch
git checkout -b "coana-$COANA_VERSION"

# Stage changes
git add package.json CHANGELOG.md pnpm-lock.yaml

# Commit (skip pre-commit hooks with -n)
git commit -n -m "upgrading coana to version $COANA_VERSION"
```

### Step 6: Push and Create PR

```bash
# Push branch
git push -u origin "coana-$COANA_VERSION"

# Create PR targeting v1.x branch
gh pr create --base v1.x --title "upgrading coana to version $COANA_VERSION" --body "$(cat <<'EOF'
## Summary
- Upgrades @coana-tech/cli from CURRENT_VERSION to COANA_VERSION

## Coana Changelog
For details on what's included in this Coana release, see the [Coana Changelogs](https://docs.coana.tech/changelogs).
EOF
)"
```

Replace `CURRENT_VERSION` and `COANA_VERSION` with actual values.

## Output

- Branch: `coana-<VERSION>` pushed to origin
- PR: Created targeting `v1.x` branch
- Files modified: `package.json`, `CHANGELOG.md`, `pnpm-lock.yaml`

Report the PR URL to the user when complete.

## Error Handling

- **No version provided**: Ask user for the version number
- **Invalid version format**: Report error with expected format
- **pnpm install fails**: Check network connectivity and npm registry access
- **PR creation fails**: Verify `gh` CLI is authenticated

## Important Notes

- Do NOT add any AI/Claude co-authorship or attribution to the commit message or PR.
- Do NOT include "Generated with Claude Code" or similar text anywhere.
