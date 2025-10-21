# Patch Backup System

## Overview

The patch backup system provides safe file backup and restore functionality before applying patches. It uses content-addressable caching (cacache + ssri) for storage and maintains lightweight metadata for quick lookups.

## Architecture

```
~/.socket/
├── _cacache/                          # Content-addressable storage
│   ├── index-v5/                      # Key → content mapping
│   └── content-v2/sha256/             # Actual file contents
└── _patches/
    └── manifests/
        └── <uuid>.json                # Metadata per patch
```

## Implementation

**Module**: `src/utils/manifest/patches/backup.mts`

### Key Functions

#### createBackup(uuid, filePath)
Creates a backup before applying a patch.

```typescript
import { createBackup } from './utils/patch-backup.mts'

const backupInfo = await createBackup('abc-123', 'node_modules/lodash/index.js')
console.log('Backed up:', backupInfo.integrity) // sha256-...
```

#### restoreBackup(uuid, filePath)
Restores a single backed up file.

```typescript
import { restoreBackup } from './utils/patch-backup.mts'

const restored = await restoreBackup('abc-123', 'node_modules/lodash/index.js')
if (restored) {
  console.log('File restored successfully')
}
```

#### restoreAllBackups(uuid)
Restores all files for a patch.

```typescript
import { restoreAllBackups } from './utils/patch-backup.mts'

const result = await restoreAllBackups('abc-123')
console.log('Restored:', result.restored.length)
console.log('Failed:', result.failed.length)
```

#### listBackups(uuid)
Lists all backed up files for a patch.

```typescript
import { listBackups } from './utils/patch-backup.mts'

const files = await listBackups('abc-123')
if (files) {
  files.forEach(file => console.log('  -', file))
}
```

#### cleanupBackups(uuid)
Removes all backups for a patch.

```typescript
import { cleanupBackups } from './utils/patch-backup.mts'

const cleaned = await cleanupBackups('abc-123')
if (cleaned) {
  console.log('All backups removed')
}
```

### Additional Functions

- `getBackupInfo(uuid, filePath)` - Get backup details for specific file
- `getPatchMetadata(uuid)` - Get full metadata for a patch
- `hasBackup(uuid, filePath)` - Check if backup exists
- `listAllPatches()` - List all patch UUIDs with backups

## Storage Details

### Cacache Keys

Backups use pattern: `socket:patch:backup:<uuid>:<filepath-hash>`

```typescript
// Example keys:
socket:patch:backup:abc-123:a1b2c3d4e5f6g7h8  // node_modules/lodash/index.js
socket:patch:backup:abc-123:9f8e7d6c5b4a3210  // node_modules/lodash/package.json
```

File paths are hashed (SHA-256, first 16 chars) to create filesystem-safe, unique identifiers.

### Metadata Format

**Location**: `~/.socket/_patches/manifests/<uuid>.json`

```json
{
  "uuid": "abc-123",
  "patchedAt": "2025-01-14T12:00:00Z",
  "files": {
    "node_modules/lodash/index.js": {
      "integrity": "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=",
      "size": 12345,
      "backedUpAt": "2025-01-14T12:00:00Z",
      "originalPath": "node_modules/lodash/index.js"
    }
  }
}
```

## Concurrency Safety

The system handles concurrent operations safely:

- **Sequential metadata writes**: Operations are queued per UUID
- **Atomic reads**: Metadata is re-read before each update
- **No race conditions**: Promise chaining ensures correct ordering

```typescript
// Safe to call concurrently - operations will be queued
await Promise.all([
  createBackup(uuid, 'file1.js'),
  createBackup(uuid, 'file2.js'),
  createBackup(uuid, 'file3.js'),
])
```

## Integrity Verification

All backups use ssri (Subresource Integrity) hashes:

- Computed during backup creation
- Verified during restore
- Standard format (sha256-base64)
- Compatible with npm ecosystem

```typescript
const backupInfo = await createBackup(uuid, filePath)
// backupInfo.integrity: "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc="

// Restore automatically verifies integrity
await restoreBackup(uuid, filePath) // Throws if integrity check fails
```

## Error Handling

Functions return boolean/undefined for normal flow, throw for unexpected errors:

```typescript
// Returns false if backup not found
const restored = await restoreBackup('non-existent-uuid', 'file.js')

// Returns undefined if patch not found
const files = await listBackups('non-existent-uuid')

// Throws for filesystem errors, permission issues, etc.
try {
  await createBackup(uuid, '/protected/file.js')
} catch (error) {
  console.error('Backup failed:', error.message)
}
```

## Usage Examples

### Complete Patch Flow

```typescript
import {
  createBackup,
  restoreBackup,
  cleanupBackups,
} from './utils/patch-backup.mts'

const uuid = 'patch-abc-123'
const filesToPatch = [
  'node_modules/lodash/index.js',
  'node_modules/lodash/package.json',
]

// 1. Create backups
for (const file of filesToPatch) {
  await createBackup(uuid, file)
}

// 2. Apply patch (modify files)
// ... patch application code ...

// 3a. If patch succeeds, keep backups
console.log('Patch applied successfully')

// 3b. If patch fails, restore backups
for (const file of filesToPatch) {
  await restoreBackup(uuid, file)
}

// 4. Later: cleanup old backups
await cleanupBackups(uuid)
```

### Interactive Restore

```typescript
import {
  listBackups,
  restoreBackup,
  getBackupInfo,
} from './utils/patch-backup.mts'

// List available backups
const files = await listBackups(uuid)
if (!files) {
  console.log('No backups found for this patch')
  return
}

console.log('Backed up files:')
for (const file of files) {
  const info = await getBackupInfo(uuid, file)
  console.log(`  ${file}`)
  console.log(`    Size: ${info!.size} bytes`)
  console.log(`    Backed up: ${info!.backedUpAt}`)
}

// Restore specific file
const restored = await restoreBackup(uuid, files[0])
console.log(restored ? 'Restored!' : 'Failed to restore')
```

### Batch Cleanup

```typescript
import { listAllPatches, cleanupBackups } from './utils/patch-backup.mts'

// Find all patches
const patches = await listAllPatches()
console.log(`Found ${patches.length} patches with backups`)

// Clean up old patches (older than 30 days)
const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

for (const uuid of patches) {
  const metadata = await getPatchMetadata(uuid)
  if (metadata) {
    const patchDate = new Date(metadata.patchedAt).getTime()
    if (patchDate < thirtyDaysAgo) {
      await cleanupBackups(uuid)
      console.log(`Cleaned up old patch: ${uuid}`)
    }
  }
}
```

## Performance

**Characteristics**:
- O(1) metadata lookup by UUID
- O(k) restore where k = files in patch (not total cache size)
- Concurrent operations queued automatically
- Deduplication via cacache (same content = same hash = stored once)

**Typical sizes**:
- Metadata file: ~1KB per patch
- Backup entry: Size of original file
- 100 patches with 3 files each = 100KB metadata + original file sizes

## Testing

**Test suite**: `src/utils/manifest/patches/backup.test.mts`
**Coverage**: 28 tests covering all core functionality

Run tests:
```bash
pnpm exec vitest run src/utils/manifest/patches/backup.test.mts
```

## Limitations

1. **Single machine**: Backups are local, not synchronized across machines
2. **No encryption**: Backups stored in plaintext (secure as original files)
3. **No compression**: Files stored as-is (cacache doesn't compress)
4. **Manual cleanup**: Old backups aren't automatically removed

## Future Enhancements

Potential improvements:
- TTL-based automatic cleanup
- Backup size limits per patch/total
- Compression support
- Remote backup storage
- Encrypted backups for sensitive files

## Related Documentation

- [Cacache On-Disk Format](./cacache-on-disk-format.md)
- [Why Metadata Files](./why-metadata-files.md)
- [Patch Cacache Patterns](./patch-cacache-patterns.md)
- [Socket Patch Implementation Plan](./socket-patch-implementation-plan.md)
