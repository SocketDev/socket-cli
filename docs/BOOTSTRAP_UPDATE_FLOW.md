# Bootstrap Node.js Juggling & Update Flow

This document describes the complete flow of Socket CLI's bootstrap mechanism, including Node.js runtime selection, update checking logic, and permission handling.

## Directory Structure

```
~/.socket/
├── _cli/                           # CLI root (all CLI-related data)
│   ├── package/                    # @socketsecurity/cli from npm
│   │   ├── package.json
│   │   ├── dist/
│   │   │   ├── cli.js             # Main CLI entry point
│   │   │   ├── commands/
│   │   │   └── utils/
│   │   ├── node_modules/
│   │   ├── requirements.json
│   │   ├── translations.json
│   │   └── shadow-bin/
│   │
│   ├── stub/                       # Stub management (SEA binary updates)
│   │   ├── downloads/             # Downloaded stub binaries
│   │   ├── staging/               # Staging area for stub updates
│   │   └── backups/               # Timestamped stub backups
│   │
│   ├── .install.lock              # Installation lock (transient, only during install)
│   └── cli-1.1.24.tgz            # Downloaded tarball (transient, deleted after extract)
│
└── _cacache/                       # All caches (cacache format)
    ├── content-v2/                # Content-addressable storage
    ├── index-v5/                  # Index for lookups
    └── tmp/                       # Temporary files
```

## 1. Bootstrap Startup - Node.js Decision Tree

```
User runs: /usr/local/bin/socket scan
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Bootstrap Stub (embedded in SEA binary)                              │
│ Checks: ~/.socket/_cli/package/package.json exists?                  │
└──────────────────────────────────────────────────────────────────────┘
           ↓ No                              ↓ Yes
┌──────────────────────────┐    ┌──────────────────────────────────────┐
│ Download & Install CLI   │    │ CLI Already Installed                 │
│ (see install flow)       │    └──────────────────────────────────────┘
└──────────────────────────┘                ↓
           ↓                     ┌──────────────────────────────────────┐
           └────────────────────→│ Detect Node.js Runtime:               │
                                │                                        │
                                │ 1. Check system Node.js:               │
                                │    spawn('node', ['--version'])       │
                                │                                        │
                                │ 2. Parse version (e.g., "v22.0.0")    │
                                │                                        │
                                │ 3. Compare: version >= MIN_NODE_VER?  │
                                │    (MIN_NODE_VERSION = 22)            │
                                └──────────────────────────────────────┘
                                            ↓
                    ┌───────────────────────┴───────────────────────┐
                    ↓ System Node >= v22                            ↓ No/Old Node
┌──────────────────────────────────────┐    ┌──────────────────────────────────────┐
│ Use System Node.js:                  │    │ Use Embedded Runtime:                │
│                                      │    │                                      │
│ spawn('node', [                      │    │ spawn(process.argv[0], [             │
│   '--no-addons',                     │    │   '--no-addons',                     │
│   '--no-warnings',                   │    │   '--no-warnings',                   │
│   '~/.socket/_cli/package/dist/cli.js',   │   '~/.socket/_cli/package/dist/cli.js',  │
│   ...args                            │    │   ...args                            │
│ ], {                                 │    │ ], {                                 │
│ })                                   │    │   stdio: ['inherit', 'inherit',      │
│                                      │    │           'inherit', 'ipc']          │
│ Benefits:                            │    │ })                                   │
│ - Faster startup (~50-200ms)         │    │                                      │
│ - Smaller memory footprint           │    │ Benefits:                            │
│ - Native module support              │    │ - Works without Node.js installed   │
└──────────────────────────────────────┘    │ - Consistent runtime version        │
                    ↓                        └──────────────────────────────────────┘
                    └───────────────────────┬───────────────────────┘
                                           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ IPC Handshake (both cases):                                          │
│                                                                       │
│ child.send({                                                          │
│   SOCKET_IPC_HANDSHAKE: {                                            │
│     SOCKET_CLI_STUB_PATH: '/usr/local/bin/socket'                    │
│   }                                                                   │
│ })                                                                    │
│                                                                       │
│ CLI receives stub path for:                                          │
│ - isSeaBinary() detection                                            │
│ - Self-update stub replacement                                       │
│                                                                       │
│ Note: CLI knows its own path via __filename/import.meta.url          │
└──────────────────────────────────────────────────────────────────────┘
```

### Node.js Detection Logic

```typescript
// In src/sea/bootstrap.mts
async function detectSystemNode(): Promise<string | null> {
  try {
    const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node'

    // Check if node exists and get version
    const { stdout } = await execFile(nodeCmd, ['--version'], { timeout: 2000 })

    // Parse version (e.g., "v22.0.0" -> 22)
    const versionMatch = stdout.trim().match(/^v(\d+)\./)
    if (!versionMatch) return null

    const majorVersion = parseInt(versionMatch[1], 10)
    if (majorVersion >= MIN_NODE_VERSION) {
      debugLog(`System Node.js v${majorVersion} meets requirements (>= v${MIN_NODE_VERSION})`)
      return nodeCmd
    } else {
      debugLog(`System Node.js v${majorVersion} too old (requires >= v${MIN_NODE_VERSION})`)
      return null
    }
  } catch {
    return null  // No system Node.js or error occurred
  }
}
```

## 2. Update Checker Package Name Logic

The update checker uses different package names depending on how the CLI is running:

```typescript
// In src/cli.mts
async function getUpdatePackageName(): string {
  if (isSeaBinary()) {
    // SEA binaries check the "socket" package on npm
    // This contains the stub binary distributions
    return 'socket'
  } else {
    // Regular npm installs check "@socketsecurity/cli"
    // This is the actual CLI package
    return '@socketsecurity/cli'
  }
}

// Usage in scheduleUpdateCheck:
await scheduleUpdateCheck({
  name: await getUpdatePackageName(),
  version: packageJson.version,
  authInfo: lookupRegistryAuthToken(registryUrl, { recursive: true }),
})
```

### Why Two Different Packages?

- **`@socketsecurity/cli`**: The main CLI package with JavaScript code
  - Changes frequently (new features, bug fixes)
  - ~30MB when installed with node_modules
  - Downloaded and extracted to `~/.socket/_cli/package/`

- **`socket`**: The stub binary package
  - Changes rarely (only for bootstrap updates)
  - Platform-specific binaries (~1-5MB each)
  - Used to update `/usr/local/bin/socket` executable

## 3. Installation Flow with Permissions

```
Download & Extract CLI:
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Download @socketsecurity/cli tarball                              │
│    → ~/.socket/_cli/cli-1.1.24.tgz                                   │
└──────────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 2. Extract with nanotar:                                             │
│    for (const file of files) {                                       │
│      const targetPath = path.join(CLI_PACKAGE_DIR, sanitizedPath)    │
│      await fs.writeFile(targetPath, fileData)                        │
│                                                                       │
│      // CRITICAL: Preserve executable permissions                    │
│      if (file.attrs?.mode) {                                         │
│        const mode = parseInt(file.attrs.mode, 8)                     │
│        await fs.chmod(targetPath, mode)                              │
│      }                                                               │
│                                                                       │
│      // Special handling for bin/ and shadow-bin/                    │
│      if (targetPath.includes('/bin/') ||                             │
│          targetPath.includes('/shadow-bin/') ||                      │
│          targetPath.includes('/dist/shadow')) {                      │
│        await fs.chmod(targetPath, 0o755) // rwxr-xr-x               │
│      }                                                               │
│    }                                                                  │
└──────────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ 3. Cleanup:                                                          │
│    - remove(~/.socket/_cli/cli-1.1.24.tgz)  # Delete tarball         │
│    - remove(~/.socket/_cli/.install.lock)   # Release lock           │
└──────────────────────────────────────────────────────────────────────┘
```

### Permission Handling Details

NPM tarballs include Unix permissions in their metadata:
- Regular files: `0644` (rw-r--r--)
- Executable files: `0755` (rwxr-xr-x)

The bootstrap ensures executables remain executable:

1. **Preserve tarball permissions**: Parse and apply the mode from tarball metadata
2. **Force executable for critical paths**:
   - `bin/` - CLI entry points
   - `shadow-bin/` - npm/npx wrappers
   - `dist/shadow/` - Shadow binary implementations

## 4. Stub Update Flow with Permissions

```
socket self-update (when isSeaBinary()):
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Check both packages:                                                 │
│ 1. npm view socket version         → Stub binary updates             │
│ 2. npm view @socketsecurity/cli version → CLI code updates           │
└──────────────────────────────────────────────────────────────────────┘
           ↓
┌──────────────────────────────────────────────────────────────────────┐
│ Update Stub Binary:                                                  │
│                                                                       │
│ 1. Download new stub:                                                │
│    const stubName = `socket-${platform}-${arch}${ext}`               │
│    → ~/.socket/_cli/stub/downloads/socket-darwin-arm64               │
│                                                                       │
│ 2. CRITICAL: Set executable permissions                              │
│    await fs.chmod(downloadPath, 0o755)                               │
│                                                                       │
│ 3. Clear macOS quarantine (if macOS):                                │
│    await exec('xattr', ['-cr', downloadPath])                        │
│                                                                       │
│ 4. Stage with permissions:                                           │
│    const stagingPath = ~/.socket/_cli/stub/staging/socket            │
│    await fs.copyFile(downloadPath, stagingPath)                      │
│    await fs.chmod(stagingPath, 0o755)                                │
│                                                                       │
│ 5. Backup current:                                                   │
│    const backupPath = `~/.socket/_cli/stub/backups/socket-${ts}`     │
│    await fs.copyFile(currentStubPath, backupPath)                    │
│    await fs.chmod(backupPath, 0o755)  // Preserve exec               │
│                                                                       │
│ 6. Atomic replace:                                                   │
│    if (process.platform === 'win32') {                               │
│      // Windows: rename current, then replace                        │
│      await fs.rename(currentPath, tempName)                          │
│      await fs.rename(stagingPath, currentPath)                       │
│    } else {                                                          │
│      // Unix: atomic rename                                          │
│      await fs.rename(stagingPath, currentPath)                       │
│    }                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### Platform-Specific Considerations

**macOS**:
- Must clear quarantine attributes: `xattr -cr <file>`
- Ad-hoc code signing may be required: `codesign --sign - <file>`

**Windows**:
- Cannot replace running executable directly
- Must rename current, then replace
- `.exe` extension required

**Linux**:
- Simple atomic rename works
- No special attributes needed

## 5. Lock File Management

The bootstrap uses `.install.lock` to prevent concurrent installations:

```typescript
async function acquireLock(): Promise<string> {
  const lockPath = path.join(SOCKET_CLI_DIR, '.install.lock')

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      // Atomic check-and-create
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' })
      return lockPath
    } catch (error) {
      if (error.code === 'EEXIST') {
        // Check if lock holder is still alive
        const lockPid = await fs.readFile(lockPath, 'utf8')
        try {
          process.kill(lockPid, 0)  // Check if process exists
          // Process exists, wait and retry
          await sleep(LOCK_RETRY_DELAY_MS)
        } catch {
          // Process dead, remove stale lock
          await remove(lockPath)
        }
      }
    }
  }
  throw new Error('Failed to acquire lock after 30 seconds')
}
```

**Critical**: Lock is **always** released in `finally` block:
```typescript
try {
  lockPath = await acquireLock()
  // ... installation ...
} finally {
  if (lockPath) {
    await releaseLock(lockPath)  // Guaranteed cleanup
  }
}
```

## 6. Cache Management

All caches use `_cacache` directory:

```typescript
// Update check cache
const cacheKey = 'update-check:@socketsecurity/cli'
await cacache.put(CACACHE_DIR, cacheKey, JSON.stringify({
  timestamp: Date.now(),
  currentVersion: '1.1.24',
  latestVersion: '1.1.25',
  lastChecked: Date.now(),
}))

// Socket API cache
const apiCacheKey = `socket-api:${endpoint}:${hash(params)}`
await cacache.put(CACACHE_DIR, apiCacheKey, response)

// GitHub API cache
const ghCacheKey = `github:${owner}/${repo}:${endpoint}`
await cacache.put(CACACHE_DIR, ghCacheKey, data)
```

## 7. Error Recovery

### Installation Failures

If installation fails:
1. Tarball is deleted (cleanup in `finally`)
2. Lock is released (cleanup in `finally`)
3. Partial extraction remains (allows debugging)

To recover:
```bash
# Clean partial installation
rm -rf ~/.socket/_cli/package

# Retry
socket --version
```

### Update Failures

If update fails:
1. New files remain in staging/downloads
2. Original binary unchanged
3. Backup preserved in backups/

To recover:
```bash
# Clean staging
rm -rf ~/.socket/_cli/stub/staging/*
rm -rf ~/.socket/_cli/stub/downloads/*

# Retry
socket self-update
```

## 8. Performance Characteristics

### Startup Times

| Scenario | Time | Notes |
|----------|------|-------|
| System Node.js (cached) | ~50-200ms | Fastest path |
| Embedded runtime (cached) | ~100-500ms | SEA overhead |
| First install | ~3-13s | Network dependent |
| Cache check | ~1ms | File existence check |
| Node version detection | ~10-50ms | Subprocess spawn |

### Disk Usage

| Component | Size | Notes |
|-----------|------|-------|
| Bootstrap stub | ~1-5MB | Platform-specific |
| CLI package | ~30MB | Includes node_modules |
| Stub backups | ~1-5MB each | Configurable retention |
| Cache (_cacache) | Variable | Auto-pruned by cacache |

## 9. Security Considerations

### Path Protection

The `remove()` function prevents catastrophic deletes:
```typescript
async function remove(filepath: string, options?: { force?: boolean }): Promise<void> {
  const absolutePath = path.resolve(filepath)

  // Prevent deleting outside SOCKET_HOME
  const relation = path.relative(SOCKET_HOME, absolutePath)
  if (!isInside) {
    throw new Error(`Cannot delete outside SOCKET_HOME`)
  }

  // Prevent deleting cwd
  if (absolutePath === cwd) {
    throw new Error('Cannot delete current working directory')
  }
}
```

### Permission Preservation

- Tarball permissions are preserved during extraction
- Executable bits are enforced for critical binaries
- Backups maintain original permissions

### Integrity Verification

Future enhancements:
- SHA256 checksums for downloaded packages
- GPG signature verification
- Certificate pinning for HTTPS

---

*Document created: 2025-10-07*