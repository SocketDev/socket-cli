# updating-checksums Reference Documentation

This document provides detailed information about external tool checksums, the sync script, and troubleshooting for the updating-checksums skill.

## Table of Contents

1. [External Tools Inventory](#external-tools-inventory)
2. [Checksum Sync Script](#checksum-sync-script)
3. [GitHub Release Tools](#github-release-tools)
4. [Checksum Formats](#checksum-formats)
5. [Edge Cases](#edge-cases)
6. [Troubleshooting](#troubleshooting)

---

## External Tools Inventory

### GitHub Release Tools (synced by this skill)

| Tool | Repository | Release Tag Format | Has checksums.txt |
|------|------------|-------------------|-------------------|
| opengrep | opengrep/opengrep | `v*.*.*` | Yes |
| python | astral-sh/python-build-standalone | `*.*.*` | No (computed) |
| socket-patch | nicolo-ribaudo/tc39-proposal-patcher | `v*.*.*` | Varies |
| sfw | SocketDev/sfw | `v*.*.*` | Varies |
| trivy | aquasecurity/trivy | `v*.*.*` | Yes |
| trufflehog | trufflesecurity/trufflehog | `v*.*.*` | Yes |

### Non-GitHub Tools (NOT synced by this skill)

| Tool | Type | Integrity Method |
|------|------|-----------------|
| @coana-tech/cli | npm | SRI integrity hash |
| @cyclonedx/cdxgen | npm | SRI integrity hash |
| synp | npm | SRI integrity hash |
| socketsecurity | pypi | SRI integrity hash |
| socket-basics | github-source | None |

---

## Checksum Sync Script

### Location

`packages/cli/scripts/sync-checksums.mjs`

### How It Works

1. Reads `packages/cli/external-tools.json`
2. Filters tools with `type: "github-release"`
3. For each tool:
   a. Fetches the GitHub release by tag
   b. Looks for `checksums.txt` asset
   c. If found: parses SHA-256 hashes from checksums.txt
   d. If not found: downloads each release asset and computes SHA-256 via `crypto.createHash('sha256')`
4. Compares new checksums with existing
5. Writes updated checksums to external-tools.json

### Command Reference

```bash
# Sync all GitHub release tools
node packages/cli/scripts/sync-checksums.mjs

# Sync specific tool only
node packages/cli/scripts/sync-checksums.mjs --tool=opengrep

# Preview changes without writing
node packages/cli/scripts/sync-checksums.mjs --dry-run

# Force update even if unchanged
node packages/cli/scripts/sync-checksums.mjs --force
```

### Expected Output

```
Syncing checksums for N GitHub release tool(s)...

[opengrep] opengrep/opengrep @ v1.16.0
  Found checksums.txt, downloading...
  Parsed 5 checksums from checksums.txt
  Updated: 2 checksums, Unchanged: 3 checksums

[trivy] aquasecurity/trivy @ v0.58.2
  Found checksums.txt, downloading...
  Parsed 12 checksums from checksums.txt
  Unchanged: 12 checksums

Summary: X updated, Y unchanged
```

---

## GitHub Release Tools

### Release Asset Patterns

Each tool has specific asset naming conventions:

**opengrep:**
- `opengrep-{version}-linux-amd64.tar.gz`
- `opengrep-{version}-darwin-arm64.tar.gz`
- `opengrep-{version}-darwin-amd64.tar.gz`

**python (python-build-standalone):**
- `cpython-{version}+{buildTag}-{target}-{config}.tar.zst`
- No checksums.txt — hashes computed by downloading each asset

**trivy:**
- `trivy_{version}_Linux-64bit.tar.gz`
- `trivy_{version}_macOS-ARM64.tar.gz`
- Includes `trivy_{version}_checksums.txt`

**trufflehog:**
- `trufflehog_{version}_linux_amd64.tar.gz`
- `trufflehog_{version}_darwin_arm64.tar.gz`
- Includes checksums in release

### Checksum Storage Format

In `external-tools.json`, checksums are stored as:

```json
{
  "checksums": {
    "asset-filename.tar.gz": "hex-encoded-sha256-hash",
    "asset-filename-2.tar.gz": "hex-encoded-sha256-hash"
  }
}
```

---

## Checksum Formats

### checksums.txt Format

Standard format used by most tools:

```
sha256hash  filename
sha256hash  filename
```

- Two or more spaces between hash and filename
- SHA-256 hex-encoded (64 characters)
- One entry per line

### Computed Checksums

When no checksums.txt is available:

```javascript
// Script computes SHA-256 by streaming the downloaded file
const hash = crypto.createHash('sha256')
const stream = fs.createReadStream(filePath)
stream.pipe(hash)
// Result: hex-encoded SHA-256
```

---

## Edge Cases

### Tool with Dual Configuration (sfw)

The `sfw` tool has both a GitHub release binary and an npm package component. The checksums skill only handles the GitHub release checksums. The npm integrity hash is separate.

### python-build-standalone

This tool has no checksums.txt in releases. The sync script must:
1. Download each release asset
2. Compute SHA-256 locally
3. This is significantly slower than parsing checksums.txt

### Version Tag Variations

Different tools use different tag formats:
- Most use `v{version}` (e.g., `v1.16.0`)
- python-build-standalone uses bare version (e.g., `3.11.14`)
- The `githubRelease` field in external-tools.json stores the exact tag

### Stale Checksums After Version Bump

If someone updates a tool version in external-tools.json but forgets to sync checksums:
- SEA builds will fail integrity verification
- Always run checksum sync after any version change

---

## Troubleshooting

### GitHub API Rate Limiting

**Symptom:** Script fails with 403 or rate limit error.

**Solution:**
```bash
# Check current rate limit
gh api rate_limit --jq '.rate'

# Ensure authenticated
gh auth status
```

Authenticated requests get 5,000 requests/hour vs 60 for unauthenticated.

### Release Not Found

**Symptom:** Script reports release not found for a tool.

**Cause:** The `githubRelease` tag in external-tools.json doesn't match any release.

**Solution:**
```bash
# Verify release exists
gh release view <tag> --repo <owner/repo>

# List recent releases
gh release list --repo <owner/repo> --limit 5
```

### Checksum Mismatch After Update

**Symptom:** Checksums changed but tool version didn't.

**Cause:** Release assets were re-uploaded (some projects rebuild releases).

**Solution:** This is expected in rare cases. Review the diff to ensure it's a legitimate update, then commit.

### JSON Validation Failure

**Symptom:** Updated external-tools.json is invalid JSON.

**Solution:**
```bash
# Validate JSON
node -e "JSON.parse(require('fs').readFileSync('packages/cli/external-tools.json'))"

# If corrupted, restore and retry
git checkout packages/cli/external-tools.json
node packages/cli/scripts/sync-checksums.mjs
```

### Large Downloads Timeout

**Symptom:** python-build-standalone sync times out (large assets).

**Solution:**
- Sync specific tool: `--tool=python`
- Ensure stable network connection
- The script handles retries for individual assets
