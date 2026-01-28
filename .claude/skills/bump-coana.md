---
description: Bump @coana-tech/cli to a new version, update changelog, and create a PR
allowed-tools: Read, Edit, Write, Bash, Glob
---

# Bump Coana CLI Version

Automates the process of upgrading the @coana-tech/cli dependency to a new version.

## Usage

```
/bump-coana <version>
```

Where `<version>` is the Coana version number (e.g., `14.12.173`).

## Instructions

When this command is invoked with a version argument ($ARGUMENTS), perform the following steps:

### 1. Validate Input
- Extract the version from $ARGUMENTS (e.g., "14.12.173").
- If no version is provided, ask the user for the Coana version to upgrade to.

### 2. Update package.json
- Read `package.json` in the repository root.
- Find the current `@coana-tech/cli` version in devDependencies and note it for the PR body.
- Update the `@coana-tech/cli` version to the provided version.
- Bump the patch version of the package (e.g., `1.1.59` becomes `1.1.60`).
- Write the updated package.json.

### 3. Update CHANGELOG.md
- Read `CHANGELOG.md` in the repository root.
- Add a new version entry at the top (after the header section that ends with "The format is based on..."), using today's date in YYYY-MM-DD format.
- The new version should match the bumped package.json version.
- Use this exact format for the new entry:

```markdown
## [NEW_VERSION](https://github.com/SocketDev/socket-cli/releases/tag/vNEW_VERSION) - YYYY-MM-DD

### Changed
- Updated the Coana CLI to v `COANA_VERSION`.

```

Note: Include the blank line after the changelog entry.

### 4. Update Lock File
- Run `pnpm install` to update pnpm-lock.yaml with the new dependency version.

### 5. Create Branch and Commit
- Create a new branch named `coana-COANA_VERSION` (e.g., `coana-14.12.173`) from the current branch.
- Stage the changes: package.json, CHANGELOG.md, and pnpm-lock.yaml.
- Create a commit with the message: `upgrading coana to version COANA_VERSION`.
- Use the `-n` flag to skip pre-commit hooks.

### 6. Push and Create PR
- Push the branch to origin with `-u` flag.
- Create a PR using `gh pr create` targeting the `v1.x` branch with:
  - Title: `upgrading coana to version COANA_VERSION`
  - Body using the format below.

Use this PR body format (use a HEREDOC for proper formatting):
```
## Summary
- Upgrades @coana-tech/cli from CURRENT_VERSION to COANA_VERSION

## Coana Changelog
For details on what's included in this Coana release, see the [Coana Changelogs](https://docs.coana.tech/changelogs).
```

Replace CURRENT_VERSION with the old version found in step 2, and COANA_VERSION with the new version.

### Important Notes
- Do NOT add any AI/Claude co-authorship or attribution to the commit message or PR.
- Do NOT include "Generated with Claude Code" or similar text anywhere.
