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
4. Write the updated `package.json`.

🚨 **Do NOT touch the top-level `version` field.** The release workflow owns it:
between releases the manifest holds the last released version, and
`scripts/release/bump.mts` derives and writes the next one in-run. Hand-writing
it invents a version that never releases and breaks the next release — a manifest
already sitting on the version being released has no line for the bump to
advance.

**Values to extract**:
- `CURRENT_VERSION`: The old @coana-tech/cli version (for PR body)

### Step 3: Update CHANGELOG.md

1. Read `CHANGELOG.md` in the repository root.
2. Find the `## [Unreleased]` heading. If it is absent — the previous release
   consumes it — recreate it directly after the header section (which ends with
   "The format is based on..."), spelled exactly `## [Unreleased]` and nothing
   else.
3. Add the entry under `## [Unreleased]`, in its `### Changed` subsection,
   creating that subsection if it is missing. If a Coana line is already there
   from an earlier unreleased bump, update it in place rather than adding a
   second one.

🚨 **Never write a `## [<version>]` heading.** Release headings belong to the
release workflow, which promotes the whole `## [Unreleased]` block under the
version it derives. Writing one here both names a version that may never exist
and consumes the block, leaving the real release with empty notes.

🚨 **Never put a date on the `## [Unreleased]` heading.** `unreleasedRange()` in
`scripts/release/changelog.mts` finds the block by matching that heading for
equality (case-insensitively, but otherwise exactly), so a heading like
`## [Unreleased] - 2026-08-27` is invisible to it. The release then promotes
nothing, falls back to a section derived from the commits in range, and inserts
its own heading *above* the block it could not see — stranding the entry below a
released version, where no release will ever pick it up. Dates belong only on
release headings, which the workflow writes.

**Resulting shape**:
```markdown
## [Unreleased]

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
- Files modified: `package.json` (the `@coana-tech/cli` devDependency only, never
  the top-level `version`), `CHANGELOG.md` (under `## [Unreleased]`), `pnpm-lock.yaml`

Report the PR URL to the user when complete.

## Error Handling

- **No version provided**: Ask user for the version number
- **Invalid version format**: Report error with expected format
- **pnpm install fails**: Check network connectivity and npm registry access
- **PR creation fails**: Verify `gh` CLI is authenticated

## Important Notes

- Do NOT add any AI/Claude co-authorship or attribution to the commit message or PR.
- Do NOT include "Generated with Claude Code" or similar text anywhere.
- Do NOT bump `package.json`'s `version` or write a `## [<version>]` changelog
  heading. Both belong to the release workflow. Hand-writing them has produced
  versions that never released and cost a real release its notes entirely.
