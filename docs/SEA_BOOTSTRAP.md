# SEA Bootstrap Architecture

## Overview

The Socket CLI uses a **custom bootstrap approach** rather than Node.js's built-in Single Executable Application (SEA) support. This provides better control over installation, updates, and version management.

## Architecture

### Bootstrap Stub

The bootstrap stub (`src/sea/bootstrap.mts`) is a lightweight wrapper (~1KB minified) that:

1. Downloads `@socketsecurity/cli` from npm on first use
2. Spawns the CLI in a subprocess (using system Node.js or embedded runtime)
3. Handles tarball extraction using inlined `nanotar` (no system `tar` dependency)
4. Supports IPC handshake for self-update mechanism

### Why Not Node's Built-in SEA?

Node.js 24+ provides `node:sea` module with `isSea()` API, but we use a custom approach because:

1. **Version Flexibility**: Can update CLI without rebuilding the entire SEA
2. **Smaller Distribution**: Bootstrap is ~1KB vs embedding entire CLI
3. **npm Integration**: Leverages npm's infrastructure for distribution
4. **Cross-Platform**: Works consistently across all platforms
5. **System Node.js Support**: Can use system Node.js when available (faster startup)

## File Structure

```
~/.socket/
├── _cli/                      # Downloaded CLI from npm
│   ├── package.json          # Version tracking
│   ├── dist/
│   │   ├── cli.js           # Main CLI entry point
│   │   └── ...
│   └── .install.lock         # Installation lock (transient)
└── _socket/updater/          # Update management (for SEA binary itself)
    ├── downloads/
    ├── staging/
    └── backups/
```

## Bootstrap Flow

### First Run

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. User executes: socket scan                                        │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Bootstrap checks for ~/.socket/_cli/package.json                  │
│    → Not found, need to download                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Create ~/.socket/_cli directory                                   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Acquire installation lock (prevents concurrent installs)          │
│    → Creates .install.lock with PID                                  │
│    → Retries up to 30 seconds if another process holds lock          │
│    → Removes stale locks (from crashed processes)                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Fetch latest version from npm registry                            │
│    → GET https://registry.npmjs.org/@socketsecurity/cli/latest       │
│    → Returns: { version: "1.1.24", ... }                             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Download tarball from npm                                         │
│    → Downloads to ~/.socket/_cli/cli-1.1.24.tgz                      │
│    → Uses retryWithBackoff for transient errors                      │
│    → Validates Content-Length header                                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 7. Extract tarball using nanotar                                     │
│    → Parses gzipped tarball (no system dependencies)                 │
│    → Sanitizes paths (prevents directory traversal)                  │
│    → Sets file permissions (preserves executable bits)               │
│    → Handles ENOSPC errors (disk full)                               │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 8. Remove tarball after successful extraction                        │
│    → Cleanup: rm ~/.socket/_cli/cli-1.1.24.tgz                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 9. Release installation lock                                         │
│    → Removes .install.lock                                           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 10. Detect Node.js version                                           │
│     → Check if system Node.js meets MIN_NODE_VERSION (v20+)          │
│     → Falls back to embedded runtime if too old or missing           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 11. Spawn CLI with IPC channel                                       │
│     → If system Node.js: node ~/.socket/_cli/dist/cli.js scan        │
│     → If embedded: <stub-path> (spawns self with IPC)                │
│     → Sends IPC handshake with SOCKET_CLI_STUB_PATH                  │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 12. CLI receives IPC handshake                                       │
│     → Sets stub path for SEA detection                               │
│     → isSeaBinary() returns true                                     │
│     → getSeaBinaryPath() returns stub path                           │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 13. CLI executes command                                             │
│     → Runs scan command                                              │
│     → Exits with status code                                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Subsequent Runs

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Bootstrap checks for ~/.socket/_cli/package.json                  │
│    → Found, skip download                                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Detect Node.js version and spawn CLI                              │
│    → Uses system Node.js or embedded runtime                         │
│    → Sends IPC handshake                                             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CLI executes command                                              │
└─────────────────────────────────────────────────────────────────────┘
```

## SEA Detection

### How It Works

SEA detection is implemented via **IPC handshake**, not Node's `node:sea` API:

1. **Bootstrap sends handshake** when spawning CLI:
   ```typescript
   // src/sea/bootstrap.mts
   child.send({
     SOCKET_IPC_HANDSHAKE: {
       SOCKET_CLI_STUB_PATH: stubPath,  // Path to SEA binary
       SOCKET_CLI_PATH: cliPath          // Path to CLI JS (for embedded mode)
     }
   })
   ```

2. **CLI receives handshake** via IPC listener:
   ```typescript
   // src/utils/stub-ipc.mts
   process.on('message', (message) => {
     if (message.SOCKET_IPC_HANDSHAKE?.SOCKET_CLI_STUB_PATH) {
       stubPath = message.SOCKET_IPC_HANDSHAKE.SOCKET_CLI_STUB_PATH
     }
   })
   ```

3. **SEA detection delegates to IPC**:
   ```typescript
   // src/utils/sea.mts
   function isSeaBinary(): boolean {
     return isRunningViaSea()  // Checks if stubPath is set
   }

   function getSeaBinaryPath(): string | undefined {
     return getStubPath()  // Returns stubPath from IPC handshake
   }
   ```

### Why IPC Instead of node:sea?

| Aspect | IPC Handshake | node:sea API |
|--------|---------------|--------------|
| **Node.js Version** | Works on Node 18+ | Requires Node 24+ |
| **Custom Bootstrap** | ✅ Yes | ❌ No (requires embedding) |
| **Stub Path** | ✅ Available | ❌ Not provided |
| **CLI Path** | ✅ Available | ❌ Not provided |
| **Flexibility** | ✅ High | ⚠️ Limited |

## Installation Lock

### Purpose

Prevents multiple SEA instances from installing simultaneously, which could cause:
- Corrupted installations (concurrent writes)
- Race conditions (incomplete extractions)
- Disk space issues (multiple downloads)

### Implementation

```typescript
// src/sea/bootstrap.mts

async function acquireLock(): Promise<string> {
  const lockPath = path.join(SOCKET_CLI_DIR, '.install.lock')

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      // Atomic check-and-create using exclusive write
      await fs.writeFile(lockPath, String(process.pid), { flag: 'wx' })
      return lockPath
    } catch (error) {
      if (error.code === 'EEXIST') {
        // Check for stale lock (process no longer exists)
        const lockPid = await fs.readFile(lockPath, 'utf8')
        try {
          process.kill(lockPid, 0)  // Check if process exists
          // Process exists, wait and retry
          await sleep(LOCK_RETRY_DELAY_MS)
          continue
        } catch {
          // Process dead, remove stale lock
          await fs.unlink(lockPath).catch(() => {})
          continue
        }
      }
      throw error
    }
  }
  throw new Error('Failed to acquire lock after 30 seconds')
}
```

### Lock Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│ Lock Created                                                          │
│ ~/.socket/_cli/.install.lock                                         │
│ Content: "12345" (PID of process holding lock)                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Installation in Progress                                             │
│ • Download tarball                                                   │
│ • Extract files                                                      │
│ • Set permissions                                                    │
│ • Remove tarball                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Lock Released (finally block)                                        │
│ rm ~/.socket/_cli/.install.lock                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Stale Lock Detection

If process crashes before releasing lock:

```typescript
// Next process checks if lock holder is still alive
const lockPid = parseInt(await fs.readFile(lockPath))
try {
  process.kill(lockPid, 0)  // Signal 0 = check existence
  // Process exists → wait for lock
} catch {
  // Process doesn't exist → remove stale lock
  await fs.unlink(lockPath)
}
```

## Error Handling

### Disk Full (ENOSPC)

```typescript
try {
  await fs.writeFile(targetPath, fileData)
} catch (error) {
  if (error.code === 'ENOSPC') {
    throw new Error(
      'Disk full: Not enough space to extract CLI. ' +
      'Free up disk space and try again.'
    )
  }
  throw error
}
```

### Network Interruption

```typescript
// Validates Content-Length header
const contentLength = response.headers['content-length']
const actualLength = buffer.length

if (actualLength !== contentLength) {
  throw new Error(
    `Download incomplete: received ${actualLength} bytes ` +
    `but expected ${contentLength} bytes. ` +
    'Network may have been interrupted.'
  )
}
```

### Transient Errors

```typescript
// Retries with exponential backoff for:
// - EBUSY (file busy)
// - EMFILE (too many open files)
// - ENFILE (system file table full)

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelay = 200,
  backoffFactor = 2
): Promise<T> {
  let delay = baseDelay
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt < maxRetries && isTransientError(error)) {
        await sleep(delay)
        delay *= backoffFactor
        continue
      }
      throw error
    }
  }
}
```

## Security

### Path Traversal Protection

```typescript
function sanitizeTarballPath(filePath: string): string {
  // Remove 'package/' prefix from npm tarballs
  const withoutPrefix = filePath.replace(/^package\//, '')

  // Filter out dangerous path segments
  const segments = withoutPrefix
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')

  // Normalize separators for current platform
  return segments.join(path.sep)
}
```

### File Permissions

```typescript
// npm tarballs preserve Unix permissions
if (file.attrs?.mode) {
  const mode = parseInt(file.attrs.mode, 8)  // Octal string to number
  if (!isNaN(mode)) {
    await fs.chmod(targetPath, mode)
  }
}

// Typical modes:
// 0000755 (rwxr-xr-x) - Executable files
// 0000644 (rw-r--r--) - Regular files
```

## Update Flow

See [`SEA_UPDATE_REVIEW.md`](./SEA_UPDATE_REVIEW.md) for details on:
- Self-update mechanism
- Binary replacement
- Backup and rollback
- GitHub releases integration

## Testing

### Unit Tests

```bash
# Test SEA detection utilities
pnpm run test:unit src/utils/sea.test.mts

# Test stub IPC handler
pnpm run test:unit src/utils/stub-ipc.test.mts
```

### Integration Tests

```bash
# Test full bootstrap flow (requires build)
pnpm run test:unit test/build-sea.test.mts
```

### Manual Testing

```bash
# Clean install
rm -rf ~/.socket/_cli
./socket --version

# Concurrent installs (should be safe)
./socket --version & ./socket --version & ./socket --version

# Disk space test (requires manual setup)
# Fill disk to ~100MB free, run socket

# Network interruption (requires manual setup)
# Kill network mid-download, verify graceful failure
```

## Build Configuration

```javascript
// .config/rollup.sea.config.mjs

export default {
  input: 'src/sea/bootstrap.mts',
  output: {
    file: 'dist/sea/bootstrap.cjs',
    format: 'cjs',  // CommonJS for Node.js SEA
    interop: 'auto',
  },
  external: [
    /^node:/,  // Externalize Node.js built-ins
  ],
  plugins: [
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node'],
    }),
    // Inline MIN_NODE_VERSION at build time
    replacePlugin({
      preventAssignment: true,
      values: {
        'process.env.MIN_NODE_VERSION': JSON.stringify(MIN_NODE_VERSION),
      },
    }),
    babelPlugin({
      babelHelpers: 'runtime',
      extensions: ['.mjs', '.js', '.ts', '.mts'],
    }),
    commonjsPlugin(),
    // Minify in production
    isProduction && UnpluginOxc({
      minify: {
        compress: {},
        mangle: true,
      },
    }),
  ],
}
```

## Performance

### Bootstrap Overhead

| Operation | Time | Notes |
|-----------|------|-------|
| Check installed version | ~1ms | `existsSync` + `fs.readFile` |
| Node.js detection | ~10-50ms | Spawns `node --version` |
| IPC handshake | ~1-5ms | In-process communication |
| Spawn CLI (system Node) | ~50-200ms | Process creation |
| Spawn CLI (embedded) | ~100-500ms | SEA startup |
| **Total (already installed)** | **~60-750ms** | Varies by runtime |

### First Install

| Operation | Time | Notes |
|-----------|------|-------|
| npm registry lookup | ~200-500ms | Network dependent |
| Download (20MB tarball) | ~2-10s | Network dependent |
| Extract tarball | ~500-2000ms | I/O dependent |
| Set permissions | ~50-200ms | Per-file chmod |
| **Total** | **~3-13s** | Varies by network |

## Troubleshooting

### "Failed to acquire installation lock"

**Cause**: Another process is installing, or stale lock exists

**Solution**:
```bash
# Check if socket process is running
ps aux | grep socket

# If no process running, manually remove lock
rm ~/.socket/_cli/.install.lock

# Try again
./socket --version
```

### "CLI entry point not found"

**Cause**: Installation incomplete or corrupted

**Solution**:
```bash
# Clean install
rm -rf ~/.socket/_cli
./socket --version  # Will re-download
```

### "Disk full" errors

**Cause**: Not enough space for ~40MB (tarball + extracted)

**Solution**:
```bash
# Check disk space
df -h ~/.socket

# Free up space
du -sh ~/.socket/_socket/updater/backups  # Old backups
rm -rf ~/.socket/_socket/updater/backups/*
```

---

*Document created: 2025-10-07*
*Author: Claude Code*
