# Socket Manifest Management

## Overview

The manifest management system provides a complete API for managing `.socket/manifest.json`, the file that tracks all patches applied to a project. It lives in the project repository and should be committed to version control.

## Implementation

**Module**: `src/utils/manifest/patches/index.mts`

### Core Features

- **Zod schema validation** - Ensures manifest integrity
- **Version support** - Schema versioning for future migrations
- **Atomic writes** - Temp file + rename prevents corruption
- **Concurrent safety** - Operation queueing prevents race conditions
- **TypeScript types** - Full type safety with exported types

## API Reference

### Types

```typescript
export type PatchFile = {
  beforeHash: string  // ssri format: sha256-base64
  afterHash: string   // ssri format: sha256-base64
}

export type Vulnerability = {
  cves: string[]      // CVE IDs
  summary: string     // One-line description
  severity: string    // LOW | MEDIUM | HIGH | CRITICAL
  description: string // Full explanation
}

export type PatchRecord = {
  uuid: string                          // UUID v4
  exportedAt: string                    // ISO 8601 timestamp
  files: Record<string, PatchFile>      // Path → hash info
  vulnerabilities: Record<string, Vulnerability>
  description: string                   // Patch description
  license: string                       // SPDX identifier
  tier: string                          // "free" | "premium"
}

export type PatchManifest = {
  version?: string                      // Schema version (default: "1.0.0")
  patches: Record<string, PatchRecord>  // PURL → patch record
}
```

### Core Functions

#### readManifest(cwd?)

Read and validate the patch manifest.

```typescript
const manifest = await readManifest()
console.log('Applied patches:', Object.keys(manifest.patches).length)
```

**Returns**: `PatchManifest` - Parsed and validated manifest, or empty manifest if file doesn't exist

**Parameters**:
- `cwd?` - Working directory (defaults to `process.cwd()`)

**Notes**:
- Returns empty manifest with version "1.0.0" if file doesn't exist
- Validates against Zod schema
- Throws on invalid JSON or schema violations

#### writeManifest(manifest, cwd?)

Write the patch manifest to disk with validation.

```typescript
const manifest = await readManifest()
manifest.patches['npm:lodash@4.17.20'] = patchRecord
await writeManifest(manifest)
```

**Parameters**:
- `manifest` - Manifest to write
- `cwd?` - Working directory (defaults to `process.cwd()`)

**Notes**:
- Validates before writing
- Uses atomic write (temp file + rename)
- Creates parent directory if needed
- Formats JSON with 2-space indentation

#### addPatch(purl, patchRecord, cwd?)

Add a patch to the manifest.

```typescript
await addPatch('npm:lodash@4.17.20', {
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  exportedAt: new Date().toISOString(),
  files: {
    'node_modules/lodash/index.js': {
      beforeHash: 'sha256-qUiQTy8...',
      afterHash: 'sha256-9f8e7d6...',
    },
  },
  vulnerabilities: { ... },
  description: 'Fixes command injection',
  license: 'MIT',
  tier: 'free'
})
```

**Parameters**:
- `purl` - Package URL (e.g., "npm:lodash@4.17.20")
- `patchRecord` - Patch record to add
- `cwd?` - Working directory

**Notes**:
- If patch already exists for this PURL, it will be replaced
- Operation is queued to prevent race conditions
- Creates manifest file if it doesn't exist

#### removePatch(purl, cwd?)

Remove a patch from the manifest.

```typescript
const removed = await removePatch('npm:lodash@4.17.20')
if (removed) {
  console.log('Patch removed from manifest')
}
```

**Returns**: `boolean` - True if patch was removed, false if it didn't exist

**Parameters**:
- `purl` - Package URL to remove
- `cwd?` - Working directory

#### getPatch(purl, cwd?)

Get a specific patch record from the manifest.

```typescript
const patch = await getPatch('npm:lodash@4.17.20')
if (patch) {
  console.log('Patch UUID:', patch.uuid)
  console.log('Files patched:', Object.keys(patch.files).length)
}
```

**Returns**: `PatchRecord | undefined` - Patch record or undefined if not found

**Parameters**:
- `purl` - Package URL to query
- `cwd?` - Working directory

#### listPatches(cwd?)

List all PURLs that have patches applied.

```typescript
const purls = await listPatches()
console.log('Applied patches:')
for (const purl of purls) {
  console.log(`  - ${purl}`)
}
```

**Returns**: `string[]` - Array of PURLs

**Parameters**:
- `cwd?` - Working directory

#### hasPatch(purl, cwd?)

Check if a patch is applied for a specific package.

```typescript
if (await hasPatch('npm:lodash@4.17.20')) {
  console.log('Patch already applied')
}
```

**Returns**: `boolean` - True if patch is applied

**Parameters**:
- `purl` - Package URL to check
- `cwd?` - Working directory

#### getAllPatches(cwd?)

Get all patch records from the manifest.

```typescript
const patches = await getAllPatches()
for (const [purl, patch] of Object.entries(patches)) {
  console.log(`${purl}: ${patch.description}`)
}
```

**Returns**: `Record<string, PatchRecord>` - Object mapping PURLs to patch records

**Parameters**:
- `cwd?` - Working directory

#### validateManifest(cwd?)

Validate that the manifest file is valid.

```typescript
if (!await validateManifest()) {
  console.error('Manifest validation failed')
}
```

**Returns**: `boolean` - True if valid

**Parameters**:
- `cwd?` - Working directory

#### migrateHashes(cwd?)

Detect legacy hash formats in the manifest.

```typescript
const migrated = await migrateHashes()
console.log(`Found ${migrated} legacy hashes`)
```

**Returns**: `number` - Number of legacy hashes detected

**Parameters**:
- `cwd?` - Working directory

**Notes**:
- Currently only detects legacy `git-sha256-*` format
- Does not perform actual conversion (requires re-reading files)
- Logs warnings for each legacy hash found

## Manifest File Format

### Location

`.socket/manifest.json` (in project root)

### Schema

```json
{
  "version": "1.0.0",
  "patches": {
    "<PURL>": {
      "uuid": "<UUID>",
      "exportedAt": "<ISO 8601>",
      "files": {
        "<file-path>": {
          "beforeHash": "sha256-...",
          "afterHash": "sha256-..."
        }
      },
      "vulnerabilities": {
        "<GHSA-ID>": {
          "cves": ["CVE-..."],
          "summary": "...",
          "severity": "HIGH",
          "description": "..."
        }
      },
      "description": "...",
      "license": "MIT",
      "tier": "free"
    }
  }
}
```

### Complete Example

```json
{
  "version": "1.0.0",
  "patches": {
    "npm:lodash@4.17.20": {
      "uuid": "123e4567-e89b-12d3-a456-426614174000",
      "exportedAt": "2025-01-14T12:00:00Z",
      "files": {
        "node_modules/lodash/lodash.js": {
          "beforeHash": "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=",
          "afterHash": "sha256-9f8e7d6c5b4a3210fedcba9876543210abcdef12345="
        },
        "node_modules/lodash/package.json": {
          "beforeHash": "sha256-abc123def456...",
          "afterHash": "sha256-xyz789ghi012..."
        }
      },
      "vulnerabilities": {
        "GHSA-jrhj-2j3q-xf3v": {
          "cves": ["CVE-2021-23337"],
          "summary": "Command injection in lodash",
          "severity": "HIGH",
          "description": "Lodash versions prior to 4.17.21 are vulnerable..."
        }
      },
      "description": "Fixes command injection vulnerability in template function",
      "license": "MIT",
      "tier": "free"
    }
  }
}
```

## Concurrency Safety

The manifest management system handles concurrent operations safely:

- **Operation queueing**: All write operations are queued per working directory
- **Atomic reads**: Manifest is re-read before each update
- **No race conditions**: Promise chaining ensures correct ordering

```typescript
// Safe to call concurrently - operations will be queued
await Promise.all([
  addPatch('npm:lodash@4.17.20', patch1),
  addPatch('npm:express@4.17.1', patch2),
  removePatch('npm:minimatch@3.0.4'),
])
```

### Implementation Details

```typescript
// Operation queue to ensure sequential manifest writes
const manifestOperations = new Map<string, Promise<any>>()

async function queueOperation<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = cwd || process.cwd()
  const previousOperation = manifestOperations.get(key) || Promise.resolve()

  const currentOperation = previousOperation.then(
    () => operation(),
    () => operation(), // Run even if previous failed
  )

  manifestOperations.set(key, currentOperation)

  try {
    return await currentOperation
  } finally {
    if (manifestOperations.get(key) === currentOperation) {
      manifestOperations.delete(key)
    }
  }
}
```

## Usage Examples

### Complete Patch Flow

```typescript
import {
  addPatch,
  getPatch,
  hasPatch,
  removePatch,
} from './utils/manifest/patches/index.mts'

const purl = 'npm:lodash@4.17.20'

// Check if patch already applied
if (await hasPatch(purl)) {
  console.log('Patch already applied')
  return
}

// Apply patch
await addPatch(purl, {
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  exportedAt: new Date().toISOString(),
  files: { ... },
  vulnerabilities: { ... },
  description: 'Fixes command injection',
  license: 'MIT',
  tier: 'free'
})

console.log('Patch applied successfully')

// Later: remove patch
const removed = await removePatch(purl)
if (removed) {
  console.log('Patch removed')
}
```

### List All Patches

```typescript
import { listPatches, getPatch } from './utils/manifest/patches/index.mts'

const purls = await listPatches()

console.log(`Found ${purls.length} applied patches:\n`)

for (const purl of purls) {
  const patch = await getPatch(purl)
  console.log(`${purl}:`)
  console.log(`  UUID: ${patch!.uuid}`)
  console.log(`  Description: ${patch!.description}`)
  console.log(`  Files: ${Object.keys(patch!.files).length}`)
  console.log(`  Vulnerabilities: ${Object.keys(patch!.vulnerabilities).length}`)
  console.log()
}
```

### Validate Manifest

```typescript
import { validateManifest } from './utils/manifest/patches/index.mts'

if (!await validateManifest()) {
  console.error('Manifest validation failed!')
  console.error('Please check .socket/manifest.json for errors')
  process.exit(1)
}

console.log('Manifest is valid')
```

### Detect Legacy Hashes

```typescript
import { migrateHashes } from './utils/manifest/patches/index.mts'

const legacyCount = await migrateHashes()

if (legacyCount > 0) {
  console.warn(`Found ${legacyCount} legacy hash format(s)`)
  console.warn('Consider re-applying patches to use current ssri format')
}
```

## Error Handling

Functions follow consistent error handling patterns:

```typescript
// Returns undefined for missing data
const patch = await getPatch('non-existent-purl')
// patch === undefined

// Returns false for failed operations
const removed = await removePatch('non-existent-purl')
// removed === false

// Throws for filesystem errors, validation errors, etc.
try {
  await writeManifest(invalidManifest)
} catch (error) {
  console.error('Failed to write manifest:', error.message)
}
```

## Testing

**Test suite**: `src/utils/manifest/patches/index.test.mts`
**Coverage**: 37 tests covering all core functionality

Run tests:
```bash
pnpm exec vitest run src/utils/manifest/patches/index.test.mts
```

### Test Coverage

- **readManifest**: 5 tests (missing file, existing file, defaults, validation)
- **writeManifest**: 5 tests (creation, directories, validation, formatting, overwrite)
- **addPatch**: 4 tests (empty manifest, multiple patches, replacement, creation)
- **removePatch**: 3 tests (existing, non-existent, selective)
- **getPatch**: 3 tests (existing, non-existent, multiple)
- **listPatches**: 3 tests (empty, multiple, after removal)
- **hasPatch**: 3 tests (existing, non-existent, after removal)
- **getAllPatches**: 2 tests (empty, multiple)
- **migrateHashes**: 3 tests (no legacy, legacy detection, empty)
- **validateManifest**: 4 tests (valid, non-existent, invalid, structure)
- **concurrent operations**: 2 tests (multiple adds, mixed operations)

## Schema Versioning

The manifest includes a `version` field to support future schema migrations:

```json
{
  "version": "1.0.0",
  "patches": { ... }
}
```

### Current Version: 1.0.0

- Initial schema with PURL-keyed patches
- Each patch has: uuid, exportedAt, files, vulnerabilities, description, license, tier
- File hashes in ssri format (sha256-base64)

### Future Versions

When the schema changes, increment the version and add migration logic:

```typescript
const manifest = await readManifest()

if (manifest.version !== CURRENT_VERSION) {
  // Migration logic here
  manifest = await migrateManifest(manifest)
}
```

See [socket-manifest-extensions.md](./socket-manifest-extensions.md) for proposed future extensions.

## Best Practices

1. **Always use the API** - Don't manually edit `.socket/manifest.json`
2. **Commit the manifest** - It's the source of truth for your team
3. **Validate after changes** - Use `validateManifest()` to catch errors
4. **Use ssri hashes** - New patches should use sha256-base64 format
5. **Concurrent operations** - The API handles queueing automatically

## Integration with Backup System

The manifest management system works alongside the backup system:

| Aspect | Manifest | Backup Metadata |
|--------|----------|-----------------|
| **Location** | `.socket/manifest.json` | `~/.socket/_patches/manifests/<uuid>.json` |
| **Committed** | Yes (in git) | No (local only) |
| **Purpose** | Patch records | Backup metadata |
| **Scope** | All patches | Single patch |
| **Contains** | Vulnerability info | Backup file info |

**Workflow**:
1. Create backup using `patch-backup.mts` → local backup metadata
2. Add patch using `patch-manifest.mts` → committed manifest
3. Team members clone repo → manifest is shared
4. Restore backup using `patch-backup.mts` → uses local backup metadata

## Related Documentation

- [Socket Manifest Format](./socket-manifest-format.md) - Detailed format specification
- [Socket Manifest Extensions](./socket-manifest-extensions.md) - Proposed extensions
- [Patch Backup System](./patch-backup-system.md) - Backup/restore functionality
- [Socket Patch Implementation Plan](./socket-patch-implementation-plan.md) - Overall plan
