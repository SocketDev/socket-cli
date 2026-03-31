---
name: updating-checksums
description: Updates SHA-256 checksums from GitHub releases to external-tools.json. Triggers when user mentions "update checksums", "sync checksums", or after releasing new tool versions.
user-invocable: true
allowed-tools: Bash, Read, Edit
---

# updating-checksums

<task>
Your task is to sync SHA-256 checksums from GitHub releases to the embedded `external-tools.json` file, ensuring SEA builds have up-to-date integrity verification.
</task>

<context>
**What is this?**
socket-cli downloads prebuilt security tools (opengrep, python, socket-patch, sfw, trivy, trufflehog) from GitHub releases for bundling into SEA (Single Executable Application) builds. Each release may include a `checksums.txt` file with SHA-256 hashes.

**Architecture:**

- `packages/cli/external-tools.json` - Configuration with embedded checksums
- `packages/cli/scripts/sync-checksums.mjs` - Sync script for GitHub release tools

**Tool Types in external-tools.json:**

| Type | Example | Checksums |
|------|---------|-----------|
| `github-release` | opengrep, trivy, sfw | Synced from releases |
| `npm` | @coana-tech/cli, synp | SRI integrity hashes |
| `pypi` | socketsecurity | May have checksums |

**Why Sync?**
- After tool updates (new versions), checksums become stale
- SEA builds verify downloads against embedded checksums
- Version-controlled checksums enable audit trail
</context>

<constraints>
**CRITICAL Requirements:**
- Network access required to fetch from GitHub API
- Only `github-release` type tools are synced

**Do NOT:**
- Modify checksums manually (always fetch from releases)
- Skip verification after sync
- Commit without reviewing changes

**Do ONLY:**
- Fetch checksums from official GitHub releases
- Update external-tools.json with new checksums
- Verify the JSON is valid after update
</constraints>

<instructions>

## Process

### Phase 1: Check Current State

<action>
Review current embedded checksums and tool versions:
</action>

```bash
# Show current GitHub release tools in external-tools.json
grep -A2 '"type": "github-release"' packages/cli/external-tools.json | head -40
```

---

### Phase 2: Sync Checksums

<action>
Run the sync script to fetch latest checksums:
</action>

```bash
# Sync all GitHub release tools
node packages/cli/scripts/sync-checksums.mjs

# Or sync specific tool
# node packages/cli/scripts/sync-checksums.mjs --tool=opengrep
```

<validation>
**Expected Output:**
```
Syncing checksums for 6 GitHub release tool(s)...

[opengrep] opengrep/opengrep @ v1.16.0
  Found checksums.txt, downloading...
  Parsed 5 checksums from checksums.txt
  Unchanged: 5 checksums

[python] astral-sh/python-build-standalone @ 3.11.14
  No checksums.txt found, downloading 8 assets to compute checksums...
  ...

Summary: X updated, Y unchanged
```

**If sync fails:**
- Check network connectivity
- Verify release exists: `gh release view <tag> --repo <owner/repo>`
- Check GitHub API rate limits
</validation>

---

### Phase 3: Verify Changes

<action>
Review the updated checksums:
</action>

```bash
# Show what changed
git diff packages/cli/external-tools.json

# Validate JSON syntax
node -e "JSON.parse(require('fs').readFileSync('packages/cli/external-tools.json'))"
```

---

### Phase 4: Commit Changes (if any)

<action>
If checksums were updated, commit the changes:
</action>

```bash
# Only if there are changes
git add packages/cli/external-tools.json
git commit -m "chore(cli): sync external tool checksums

Update embedded SHA-256 checksums from GitHub releases.
Enables SEA builds with up-to-date integrity verification."
```

</instructions>

## Success Criteria

- All GitHub release tools synced from releases
- external-tools.json updated with latest checksums
- JSON syntax validated
- Changes committed (if any updates)

## Commands

```bash
# Sync all GitHub release tools
node packages/cli/scripts/sync-checksums.mjs

# Sync specific tool
node packages/cli/scripts/sync-checksums.mjs --tool=opengrep

# Dry run (show what would change)
node packages/cli/scripts/sync-checksums.mjs --dry-run

# Force update even if unchanged
node packages/cli/scripts/sync-checksums.mjs --force
```

## Context

This skill is useful for:

- After updating tool versions in external-tools.json
- When new GitHub releases are published
- Before building SEA executables
- Regular maintenance to keep checksums current

**Behavior:**
1. First tries to download `checksums.txt` from the GitHub release
2. If not available, downloads each asset and computes SHA-256 hashes
3. Only updates tools with `type: "github-release"`
4. npm packages use SRI integrity hashes (not handled by this script)
