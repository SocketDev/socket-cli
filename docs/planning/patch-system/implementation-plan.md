# Socket Patch Implementation Plan

## Overview

Implement a comprehensive Socket patch system that integrates with the depscan API, manages patch backups, and supports both legacy and modern hash formats.

---

## Architecture Decisions (Finalized)

### Directory Structure: `~/.socket/`

```
~/.socket/
├── _cacache/              # Content-addressable cache (shared, managed by cacache)
│   ├── content-v2/        # Actual file content by hash
│   │   ├── sha256/        # SHA-256 content buckets
│   │   └── sha512/        # SHA-512 content buckets
│   ├── index-v5/          # Cache index
│   └── tmp/               # Temporary files
├── _patches/              # Patch-specific data
│   ├── manifests/         # Patch metadata (JSON files)
│   └── backups/           # Original file backups (stored in _cacache by hash)
├── _cli/                  # JavaScript package (@socketsecurity/cli)
├── _dlx/                  # DLX binaries
├── _socket/               # SEA binary management
└── _registry/             # Socket Registry app directory
```

### Hash Format Strategy

**Decision**: Use **ssri format (sha256-base64)** for all new patches

- **Format**: `sha256-base64hash` (e.g., `sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=`)
- **Legacy Support**: Detect and convert `git-sha256-hexhash` format during transition
- **Benefits**:
  - Standard format used by npm, pnpm, yarn lockfiles
  - Compatible with cacache library
  - Self-describing (algorithm prefix)
  - Compact base64 encoding

### Manifest Location

- **User Repo**: `.socket/manifest.json` (committed to git)
- **Schema**: Defined in `depscan/workspaces/lib/src/security-patch/autopatcher/manifest-schema.ts`

### Storage Strategy

1. **Downloads** (patch tarballs): Store in `_cacache` by content hash
2. **Backups** (original files): Store in `_cacache` by content hash
3. **Metadata** (patch info): Store in `_patches/manifests/<uuid>.json`

**Rationale for _cacache**:
- Automatic deduplication
- Integrity checking via ssri
- Efficient storage with content-addressing
- Shared across Socket CLI features
- Automatic cleanup/garbage collection support

---

## Implementation Plan

### Phase 1: Backup System ⬅️ **WE ARE HERE**

#### 1.1 Backup Storage Implementation

**Location**: `src/utils/manifest/patches/backup.mts`

**Key Functions**:
```typescript
// Store backup before applying patch
async function createBackup(
  filePath: string,
  patchUuid: string
): Promise<{ hash: string; originalPath: string }>

// Restore backup by UUID and file path
async function restoreBackup(
  patchUuid: string,
  filePath: string
): Promise<boolean>

// List all backups for a patch
async function listBackups(
  patchUuid: string
): Promise<Array<{ path: string; hash: string }>>

// Clean up backups for removed patch
async function cleanupBackups(
  patchUuid: string
): Promise<void>
```

**Implementation Details**:
1. Read original file content
2. Compute ssri hash: `sha256-base64`
3. Store in cacache using key pattern: `socket:patch:backup:<uuid>:<filepath-hash>`
4. Store metadata in `_patches/manifests/<uuid>.json`:
   ```json
   {
     "uuid": "patch-uuid",
     "backups": {
       "relative/path/to/file.js": {
         "hash": "sha256-...",
         "size": 1234,
         "backedUpAt": "2025-01-14T12:00:00Z"
       }
     }
   }
   ```

**Cacache Integration**:
```typescript
import { get, put } from '@socketsecurity/registry/lib/cacache'

// Store backup
await put(
  `socket:patch:backup:${uuid}:${filePathHash}`,
  fileContent,
  {
    metadata: {
      originalPath: filePath,
      uuid: patchUuid,
      backedUpAt: new Date().toISOString()
    }
  }
)

// Retrieve backup
const entry = await get(`socket:patch:backup:${uuid}:${filePathHash}`)
const content = entry.data
```

#### 1.2 Backup Metadata Schema

**File**: `_patches/manifests/<uuid>.json`

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

#### 1.3 Backup CLI Commands

```bash
# List backups for a patch
socket patch list-backups <UUID>

# Restore a specific file
socket patch restore <UUID> <file-path>

# Restore all files from a patch
socket patch restore <UUID> --all

# Clean up backups
socket patch cleanup <UUID>
socket patch cleanup --all  # Clean all patch backups
```

### Phase 2: Manifest Management

#### 2.1 Manifest Schema Validation

**Use existing schema from depscan**:
- Location: `depscan/workspaces/lib/src/security-patch/autopatcher/manifest-schema.ts`
- Validation: Zod schema with `PatchManifestSchema`
- Fields: uuid, exportedAt, files (beforeHash/afterHash), vulnerabilities, description, license, tier

#### 2.2 Manifest Update Flow

```typescript
// Read existing manifest
const manifest = await readManifest('.socket/manifest.json')

// Apply patch (creates backup first)
const patchResult = await applyPatch(patchUuid, files)

// Update manifest with patch record
manifest.patches[purl] = {
  uuid: patchUuid,
  exportedAt: new Date().toISOString(),
  files: {
    'path/to/file.js': {
      beforeHash: 'sha256-original...',
      afterHash: 'sha256-patched...'
    }
  },
  vulnerabilities: { /* GHSA data */ },
  description: 'Patch description',
  license: 'MIT',
  tier: 'free'
}

// Write updated manifest
await writeManifest('.socket/manifest.json', manifest)
```

#### 2.3 Hash Format Migration

**Handled by `src/utils/manifest/patches/hash.mts`** (✅ Already implemented):
- Detect legacy `git-sha256-` format
- Validate against content
- Convert to ssri format
- Update manifest with new hashes

### Phase 3: Patch Commands

#### 3.1 Core Commands

```bash
# Primary command: Run scan internally and apply patches
socket patch [<GHSA-IDs...>] [options]
  --apply             # Actually apply patches (default: dry-run)
  --org <slug>        # Organization slug
  --output <file>     # Output patch info to file
  --glob <pattern>    # Filter files to patch

# Get specific patch details
socket patch info <UUID>

# Download patch without applying
socket patch get <UUID> [--output <file>]

# List applied patches
socket patch list [--org <slug>]

# Remove patch (restores backups)
socket patch rm <UUID> [--keep-backups]

# Clean up old backups
socket patch cleanup [UUID] [--all]
```

#### 3.2 Internal Scan Flow

**Pattern**: Follow `socket fix` implementation

```typescript
// 1. Upload manifests (triggers scan internally)
const uploadCResult = await handleApiCall(
  sockSdk.uploadManifestFiles(orgSlug, scanFilepaths),
  { description: 'upload manifests', spinner }
)
const tarHash = uploadCResult.data.tarHash

// 2. Fetch available patches from API
const patchesResult = await sockSdk.getAvailablePatches(tarHash, ghsaIds)

// 3. For each patch:
//    a. Create backup
//    b. Apply patch
//    c. Update manifest
//    d. Commit changes (if in CI)
```

### Phase 4: Integration with Depscan API

#### 4.1 API Endpoints (Existing in depscan)

**Base**: `workspaces/api-v0/src/endpoints/orgs/patches`

Endpoints:
- `GET /orgs/:orgSlug/patches` - List available patches
- `GET /orgs/:orgSlug/patches/:uuid` - Get patch details
- `POST /orgs/:orgSlug/patches/:uuid/apply` - Apply patch (returns tarball)
- `GET /orgs/:orgSlug/patches/scan/:tarHash` - Get patches for scan results

#### 4.2 SDK Integration

**Location**: `src/utils/sdk.mts` (extend SocketSdk)

```typescript
interface SocketSdk {
  // Existing methods...

  // New patch methods
  getAvailablePatches(
    tarHash: string,
    ghsaIds?: string[]
  ): Promise<PatchInfo[]>

  getPatchDetails(
    orgSlug: string,
    uuid: string
  ): Promise<PatchDetails>

  downloadPatch(
    orgSlug: string,
    uuid: string
  ): Promise<Buffer> // Tarball content
}
```

### Phase 5: Testing & Documentation

#### 5.1 Unit Tests

- `src/utils/manifest/patches/backup.test.mts` - Backup/restore functionality
- `src/utils/manifest/patches/index.test.mts` - Manifest read/write/validate
- `src/commands/patch/*.test.mts` - Command tests

#### 5.2 Integration Tests

- End-to-end patch apply/restore flow
- Manifest migration (git-sha256 → ssri)
- Backup integrity verification

#### 5.3 Documentation

- User guide: How to use patch commands
- Developer guide: Architecture and implementation
- Migration guide: Upgrading from legacy format

---

## Current Status

### ✅ Completed

1. **Hash utilities** (`src/utils/manifest/patches/hash.mts`)
   - Format detection (ssri vs git-sha256)
   - Validation for both formats
   - Conversion from git-sha256 to ssri
   - 30 tests passing

2. **Documentation** (`fixtures/socket-registry-overrides-test.md`)
   - Usage examples
   - Format comparison
   - Migration strategy

### 🚧 In Progress

**Phase 1.1**: Backup System Implementation

### 📋 TODO

1. Implement `src/utils/manifest/patches/backup.mts`
2. Implement `src/utils/manifest/patches/index.mts`
3. Implement `src/commands/patch/` command handlers
4. Extend SDK with patch methods
5. Add comprehensive tests
6. Write user documentation

---

## Key Questions to Resolve

1. **Backup Retention**: How long should backups be kept?
   - Option A: Keep until patch is removed
   - Option B: Keep for N days
   - Option C: Keep until cleanup command is run

2. **Backup Conflicts**: What if same file is patched multiple times?
   - Option A: Only keep original (first) backup
   - Option B: Chain backups (patch1 → patch2 → patch3)
   - Option C: Fail if file already patched

3. **Manifest Sync**: How to handle manifest divergence?
   - Manifest says patched, but backup missing
   - Backup exists, but not in manifest
   - File contents don't match manifest hashes

4. **Cross-project Patches**: Can patches apply across repos?
   - Store backups per-project or globally?
   - How to identify "same" file across projects?

---

## References

### Key Files Examined

1. **`/Users/jdalton/projects/depscan/workspaces/lib/src/security-patch/autopatcher/manifest-schema.ts`**
   - Official manifest schema

2. **`/Users/jdalton/projects/socket-registry/registry/src/lib/paths.ts`**
   - Socket directory structure

3. **`/Users/jdalton/projects/socket-registry/registry/src/lib/cacache.ts`**
   - Cacache integration patterns

4. **`/Users/jdalton/projects/socket-cli/src/commands/fix/coana-fix.mts`**
   - Internal scan pattern (model for patch command)

### Related Documentation

- **Socket Registry**: `socket-registry/CLAUDE.md`
- **Socket CLI**: `socket-cli/package.json` (commands structure)
- **Depscan API**: `depscan/workspaces/api-v0/src/endpoints/orgs/patches`

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-01-14 | Use ssri format for new patches | Standard format, cacache compatible, used by npm/pnpm/yarn |
| 2025-01-14 | Support git-sha256 during transition | Legacy patches need migration path |
| 2025-01-14 | Store backups in _cacache | Deduplication, integrity checking, shared cache |
| 2025-01-14 | Store metadata in _patches/manifests/ | Separate concerns, browsable metadata |
| 2025-01-14 | Follow socket fix pattern for internal scan | Proven pattern, consistent UX |

---

## Next Immediate Step

**Implement Phase 1.1: Backup Storage**

Create `src/utils/manifest/patches/backup.mts` with:
1. `createBackup()` - Store original file in cacache
2. `restoreBackup()` - Retrieve and write back original file
3. `listBackups()` - List all backups for a patch
4. `cleanupBackups()` - Remove backups from cacache

This will establish the foundation for the entire patch system.
