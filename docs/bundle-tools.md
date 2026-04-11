# External Tools

Socket CLI integrates with external security tools for scanning, analysis, and vulnerability detection. This document explains how tools are bundled and executed in different deployment modes.

## Deployment Modes

| Mode | Description | Tool Source |
|------|-------------|-------------|
| **SEA** | Standalone executable with bundled VFS | Tools pre-bundled at build time |
| **npm CLI** | Installed via npm/pnpm/yarn | Tools downloaded at runtime |

## Tool Matrix

| Tool | Type | SEA Mode | npm CLI Mode |
|------|------|----------|--------------|
| @coana-tech/cli | npm | VFS (node_modules) | dlx download |
| @cyclonedx/cdxgen | npm | VFS (node_modules) | dlx download |
| opengrep | github-release | VFS (/snapshot/) | GitHub download |
| python | github-release | VFS (/snapshot/) | GitHub download |
| socket-basics | github-source | VFS (pre-installed) | N/A (SEA only) |
| socket-patch | github-release | VFS (/snapshot/) | GitHub download |
| socketsecurity | pypi | VFS (pre-installed via pip) | pip install |
| sfw | hybrid | VFS (GitHub binary) | dlx (npm package) |
| synp | npm | VFS (node_modules) | dlx download |
| trivy | github-release | VFS (/snapshot/) | GitHub download |
| trufflehog | github-release | VFS (/snapshot/) | GitHub download |

## Configuration

All tools are defined in `packages/cli/bundle-tools.json`:

```json
{
  "tool-name": {
    "description": "Tool description",
    "type": "npm | github-release | pypi | github-source",
    "version": "1.0.0",
    "checksums": { ... }
  }
}
```

---

## SEA Mode (Standalone Executable)

SEA binaries contain all tools pre-bundled in a Virtual File System (VFS). Tools are extracted to a temp directory on first use.

### VFS Structure

```
/snapshot/
├── node_modules/           # npm packages with full dependency trees
│   ├── @coana-tech/cli/
│   ├── @cyclonedx/cdxgen/
│   ├── @socketsecurity/sfw-bin/sfw
│   └── synp/
├── opengrep/               # Standalone binaries
├── python/                 # Python runtime + pre-installed packages
│   └── lib/python3.11/site-packages/
│       ├── socketsecurity/
│       └── socket_basics/
├── socket-patch/
├── trivy/
└── trufflehog/
```

### Python Package Pre-bundling

Python packages (`socketsecurity`, `socket_basics`) are installed at **build time** into the bundled Python:

1. Build downloads `python-build-standalone` runtime
2. Build runs `pip install socketsecurity==X.X.X` into bundled Python
3. Build copies `socket-basics` source into site-packages
4. VFS contains complete Python with packages pre-installed
5. Runtime skips pip install (checks `import socketsecurity` first)

### VFS Extraction

Tools are extracted on first use to `~/.socket/_vfs/`:

```typescript
// Detection
if (isSeaBinary() && areExternalToolsAvailable()) {
  // Use VFS-extracted tool
  return spawnToolVfs(args, options)
}
```

---

## npm CLI Mode

When installed via npm, tools are downloaded at runtime.

### Download Locations

| Source | Cache Location |
|--------|----------------|
| npm dlx | `~/.socket/_dlx/{package}@{version}/` |
| GitHub releases | `~/.socket/_dlx/github/{owner}/{repo}/{version}/` |
| PyPI | `~/.socket/_dlx/pypi/{package}/{version}/` |
| Python runtime | `~/.socket/_dlx/python/{version}-{tag}-{platform}-{arch}/` |

### Download Flow

```
1. Check local path override (SOCKET_CLI_*_LOCAL_PATH env var)
   └── If set, use local binary directly

2. Check cache
   └── If cached and valid, use cached binary

3. Download
   ├── npm packages: dlxPackage() from npm registry
   ├── GitHub releases: downloadGitHubReleaseBinary()
   └── PyPI packages: downloadPyPIWheel()

4. Verify integrity
   └── SHA-256 checksum validation (required in production)

5. Extract and cache
   └── Save to ~/.socket/_dlx/
```

---

## Security

### Checksum Verification

All downloads are verified with SHA-256 checksums defined in `bundle-tools.json`:

```json
{
  "trivy": {
    "checksums": {
      "trivy_0.69.2_macOS-ARM64.tar.gz": "320c0e6af90b5733...",
      "trivy_0.69.2_Linux-64bit.tar.gz": "affa59a1e37d86e4..."
    }
  }
}
```

Checksums are **required** in production builds. Dev mode allows downloads without checksums for testing.

### Archive Extraction Safety

- Path traversal validation (no `../` escapes)
- Symlink target validation (no escapes via symlinks)
- Lock file protection against concurrent downloads

### Local Path Overrides

Environment variables for development/testing:

| Variable | Tool |
|----------|------|
| `SOCKET_CLI_CDXGEN_LOCAL_PATH` | cdxgen |
| `SOCKET_CLI_COANA_LOCAL_PATH` | coana |
| `SOCKET_CLI_PYCLI_LOCAL_PATH` | socketsecurity |
| `SOCKET_CLI_SFW_LOCAL_PATH` | sfw |
| `SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH` | socket-patch |

---

## Implementation Files

| File | Purpose |
|------|---------|
| `bundle-tools.json` | Tool definitions, versions, checksums |
| `src/utils/dlx/resolve-binary.mts` | Binary resolution logic |
| `src/utils/dlx/spawn.mts` | Tool spawning (VFS + dlx) |
| `src/utils/dlx/vfs-extract.mts` | VFS extraction utilities |
| `src/utils/basics/spawn.mts` | Python-based tools (basics) |
| `src/utils/basics/vfs-extract.mts` | Basics tools VFS extraction |
| `src/env/*-version.mts` | Version getters (esbuild inlined) |
| `src/env/*-checksums.mts` | Checksum getters (esbuild inlined) |

---

## Adding a New Tool

1. Add entry to `bundle-tools.json` with version and checksums
2. Create `src/env/{tool}-version.mts` version getter
3. Create `src/env/{tool}-checksums.mts` checksum getter (if applicable)
4. Add resolve function in `src/utils/dlx/resolve-binary.mts`
5. Add spawn functions in `src/utils/dlx/spawn.mts`:
   - `spawn{Tool}Vfs()` - VFS extraction path
   - `spawn{Tool}Dlx()` - Download path
   - `spawn{Tool}()` - Auto-detect wrapper
6. Update build scripts to bundle tool in VFS (for SEA)
