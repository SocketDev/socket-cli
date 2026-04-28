---
name: updating-checksums
description: >
  Syncs SHA-256 checksums from GitHub releases to bundle-tools.json.
  Triggers when user mentions "update checksums", "sync checksums", or after
  releasing new tool versions.
user-invocable: true
allowed-tools: Read, Edit, Bash(node packages/cli/scripts/sync-checksums.mjs:*), Bash(git diff:*), Bash(git status:*), Bash(git add:*), Bash(git commit:*)
---

# updating-checksums

<task>
Your task is to sync SHA-256 checksums from GitHub releases to the embedded `bundle-tools.json` file, ensuring SEA builds have up-to-date integrity verification.
</task>

<constraints>
- Network access required to fetch from GitHub API.
- Only `github-release` type tools are synced (not npm or pypi).
- Never modify checksums manually; always fetch from releases.
- Verify JSON validity after sync.
- Review changes before committing.
</constraints>

## Phases

1. **Check Current State** - Review current checksums and tool versions in `packages/cli/bundle-tools.json`.
2. **Sync Checksums** - Run `node packages/cli/scripts/sync-checksums.mjs`. Tries `checksums.txt` from the release first; falls back to downloading assets and computing SHA-256.
3. **Verify Changes** - `git diff packages/cli/bundle-tools.json`; validate JSON syntax.
4. **Commit Changes** - If updated, commit `packages/cli/bundle-tools.json`.

## Commands

```bash
node packages/cli/scripts/sync-checksums.mjs              # Sync all
node packages/cli/scripts/sync-checksums.mjs --tool=opengrep  # Sync one
node packages/cli/scripts/sync-checksums.mjs --dry-run     # Preview
node packages/cli/scripts/sync-checksums.mjs --force       # Force update
```
