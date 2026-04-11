Sync SHA-256 checksums from GitHub releases to bundle-tools.json using the syncing-checksums skill.

## What it does

1. Fetches checksums.txt from GitHub releases (or computes from assets)
2. Updates packages/cli/bundle-tools.json
3. Validates JSON syntax
4. Commits changes (if any)

## Tools synced

Only `github-release` type tools are synced:

- opengrep - OpenGrep SAST/code analysis engine
- python - Python runtime from python-build-standalone
- socket-patch - Socket Patch CLI (Rust binary)
- sfw - Socket Firewall
- trivy - Container vulnerability scanner
- trufflehog - Secret detection

## Usage

```bash
/sync-checksums
```

## Manual commands

```bash
# Sync all GitHub release tools
node packages/cli/scripts/sync-checksums.mjs

# Sync specific tool
node packages/cli/scripts/sync-checksums.mjs --tool=opengrep

# Dry run
node packages/cli/scripts/sync-checksums.mjs --dry-run
```
