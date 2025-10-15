# Patch Cacache Key Patterns

## Overview

Socket patch system uses content-addressable caching via `cacache` and `ssri` for storing backups and downloads.

## Using ssri Library

We use the `ssri` package (pinned at v12.0.0) for all hash operations, following patterns from `pacote` and `cacache`.

### Key ssri Functions

```typescript
import ssri from 'ssri'

// Compute integrity from data
const integrity = ssri.fromData(buffer, { algorithms: ['sha256'] })
integrity.toString() // 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='

// Validate data against integrity
const isValid = ssri.checkData(buffer, 'sha256-...')
// Returns Integrity object if valid, false if invalid

// Parse integrity string
const parsed = ssri.parse('sha256-...')
parsed.hexDigest() // Get hex format of hash

// Convert hex to ssri (e.g., from npm dist.shasum)
const fromHex = ssri.fromHex('abc123...', 'sha1')
fromHex.toString() // 'sha1-...'
```

## Cacache Key Patterns

### 1. Backup Storage Pattern

**Format**: `socket:patch:backup:<uuid>:<filepath-hash>`

**Example**:
```
socket:patch:backup:123e4567-e89b-12d3-a456-426614174000:a1b2c3d4e5f6g7h8
```

**Usage**:
```typescript
import { put, get } from '@socketsecurity/registry/lib/cacache'
import ssri from 'ssri'
import crypto from 'node:crypto'

// Hash the file path (for key uniqueness)
function hashFilePath(filePath: string): string {
  return crypto.createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16) // 16 chars sufficient
}

// Store backup
async function storeBackup(
  uuid: string,
  filePath: string,
  content: Buffer
): Promise<string> {
  const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`

  // Compute integrity using ssri
  const integrity = ssri.fromData(content, { algorithms: ['sha256'] })

  const result = await put(key, content, {
    integrity: integrity.toString(), // Pass ssri string to cacache
    metadata: {
      originalPath: filePath,
      uuid,
      backedUpAt: new Date().toISOString()
    }
  })

  // result.integrity is an ssri Integrity object
  return result.integrity.toString() // 'sha256-...'
}

// Retrieve backup
async function retrieveBackup(
  uuid: string,
  filePath: string
): Promise<Buffer> {
  const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`

  const entry = await get(key)

  // entry.integrity is the ssri string
  // entry.data is the Buffer
  // Cacache automatically validates integrity when retrieving

  return entry.data
}

// Retrieve with explicit integrity check
async function retrieveBackupWithIntegrity(
  uuid: string,
  filePath: string,
  expectedIntegrity: string
): Promise<Buffer> {
  const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`

  // Pass integrity option to cacache.get
  // Will throw if integrity doesn't match
  const entry = await get(key, {
    integrity: expectedIntegrity
  })

  return entry.data
}
```

### 2. Patch Download Pattern

**Format**: `socket:patch:download:<uuid>`

**Example**:
```
socket:patch:download:123e4567-e89b-12d3-a456-426614174000
```

**Usage**:
```typescript
import { put, get, safeGet } from '@socketsecurity/registry/lib/cacache'
import ssri from 'ssri'

// Store downloaded patch tarball
async function cachePatchDownload(
  uuid: string,
  tarball: Buffer,
  expectedIntegrity?: string
): Promise<string> {
  const key = `socket:patch:download:${uuid}`

  // Compute integrity if not provided
  const integrity = expectedIntegrity
    ? ssri.parse(expectedIntegrity)
    : ssri.fromData(tarball, { algorithms: ['sha512'] })

  const result = await put(key, tarball, {
    integrity: integrity.toString(),
    metadata: {
      uuid,
      downloadedAt: new Date().toISOString()
    }
  })

  return result.integrity.toString()
}

// Retrieve cached patch (avoid re-download)
async function getCachedPatch(
  uuid: string
): Promise<Buffer | undefined> {
  const key = `socket:patch:download:${uuid}`

  // Use safeGet to avoid throwing if not cached
  const entry = await safeGet(key)

  return entry?.data
}

// Retrieve with integrity verification
async function getCachedPatchWithIntegrity(
  uuid: string,
  expectedIntegrity: string
): Promise<Buffer | undefined> {
  const key = `socket:patch:download:${uuid}`

  try {
    const entry = await get(key, {
      integrity: expectedIntegrity
    })
    return entry.data
  } catch {
    // Not found or integrity mismatch
    return undefined
  }
}
```

## Metadata Storage

Patch metadata is stored in filesystem (NOT cacache):

**Location**: `~/.socket/_patches/manifests/<uuid>.json`

**Schema**:
```typescript
interface PatchBackupMetadata {
  uuid: string
  patchedAt: string // ISO timestamp
  backups: Record<string, {
    hash: string        // ssri format: sha256-base64
    size: number        // bytes
    backedUpAt: string  // ISO timestamp
    originalPath: string // absolute or relative path
  }>
}
```

**Example**:
```json
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "patchedAt": "2025-01-14T12:00:00Z",
  "backups": {
    "node_modules/lodash/index.js": {
      "hash": "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=",
      "size": 12345,
      "backedUpAt": "2025-01-14T12:00:00Z",
      "originalPath": "node_modules/lodash/index.js"
    }
  }
}
```

## Complete Example: Backup and Restore Flow

```typescript
import { put, get, remove } from '@socketsecurity/registry/lib/cacache'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import ssri from 'ssri'
import crypto from 'node:crypto'

// Helper to hash file paths
function hashFilePath(filePath: string): string {
  return crypto.createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16)
}

// Helper to get metadata file path
function getMetadataPath(uuid: string): string {
  const socketHome = process.env.HOME + '/.socket'
  return join(socketHome, '_patches', 'manifests', `${uuid}.json`)
}

// Create backup before patching
async function createBackup(
  uuid: string,
  filePath: string
): Promise<{ hash: string; size: number }> {
  // Read original file
  const content = await fs.readFile(filePath)

  // Compute integrity using ssri
  const integrity = ssri.fromData(content, { algorithms: ['sha256'] })
  const hash = integrity.toString()

  // Store in cacache
  const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`
  await put(key, content, {
    integrity: hash,
    metadata: {
      originalPath: filePath,
      uuid,
      backedUpAt: new Date().toISOString()
    }
  })

  // Read/update metadata file
  const metadataPath = getMetadataPath(uuid)
  let metadata: any
  try {
    const data = await fs.readFile(metadataPath, 'utf-8')
    metadata = JSON.parse(data)
  } catch {
    metadata = {
      uuid,
      patchedAt: new Date().toISOString(),
      backups: {}
    }
  }

  metadata.backups[filePath] = {
    hash,
    size: content.length,
    backedUpAt: new Date().toISOString(),
    originalPath: filePath
  }

  await fs.mkdir(join(metadataPath, '..'), { recursive: true })
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))

  return { hash, size: content.length }
}

// Restore backup
async function restoreBackup(
  uuid: string,
  filePath: string
): Promise<boolean> {
  // Read metadata to get hash
  const metadataPath = getMetadataPath(uuid)
  const data = await fs.readFile(metadataPath, 'utf-8')
  const metadata = JSON.parse(data)

  const backup = metadata.backups[filePath]
  if (!backup) {
    return false
  }

  // Retrieve from cacache with integrity check
  const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`
  const entry = await get(key, {
    integrity: backup.hash // Verify integrity on retrieval
  })

  // Write back to original location
  await fs.writeFile(filePath, entry.data)

  return true
}

// Cleanup backups when removing patch
async function cleanupBackups(uuid: string): Promise<void> {
  // Read metadata to get all backup keys
  const metadataPath = getMetadataPath(uuid)
  const data = await fs.readFile(metadataPath, 'utf-8')
  const metadata = JSON.parse(data)

  // Remove each backup from cacache
  for (const filePath of Object.keys(metadata.backups)) {
    const key = `socket:patch:backup:${uuid}:${hashFilePath(filePath)}`
    await remove(key)
  }

  // Remove metadata file
  await fs.unlink(metadataPath)
}
```

## Benefits of Using ssri

1. **Standard Format**: Same format as npm, pnpm, yarn lockfiles
2. **Built-in Validation**: `ssri.checkData()` handles validation
3. **Multiple Algorithms**: Supports sha1, sha256, sha512
4. **Conversion Utilities**: `fromHex()`, `parse()`, `hexDigest()`
5. **Cacache Integration**: Cacache expects ssri format
6. **Error Handling**: Proper validation and error reporting

## Integration with Cacache

Cacache automatically:
- Validates integrity when retrieving with `integrity` option
- Stores content by hash (content-addressable)
- Deduplicates identical content
- Handles concurrent access safely

## Key Patterns Summary

| Pattern | Usage | Count per Patch |
|---------|-------|-----------------|
| `socket:patch:backup:<uuid>:<filepath-hash>` | Original file backups | 1 per file |
| `socket:patch:download:<uuid>` | Patch tarball cache | 1 per patch |
| `_patches/manifests/<uuid>.json` | Metadata (filesystem) | 1 per patch |

**Example Totals**:
- Patch affecting 5 files = 5 backup entries + 1 download entry + 1 metadata file
- 10 patches affecting 3 files each = 30 backup entries + 10 download entries + 10 metadata files
