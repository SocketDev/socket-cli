# Socket Manifest Format (.socket/manifest.json)

## Overview

The `.socket/manifest.json` file tracks all patches applied to a project. It lives in the user's repository and should be committed to version control.

**Location**: `.socket/manifest.json` (in project root)

## Purpose

The manifest serves as:
1. **Source of truth** for which patches are applied
2. **Commit record** (tracked in git)
3. **Reproducible state** (other devs get same patches)
4. **Vulnerability documentation** (explains what was fixed)

## Schema

Defined in: `depscan/workspaces/lib/src/security-patch/autopatcher/manifest-schema.ts`

### Top-Level Structure

```typescript
{
  "patches": {
    "<PURL>": PatchRecord,
    "<PURL>": PatchRecord,
    ...
  }
}
```

**Key**: PURL (Package URL) identifies the package
- Examples:
  - `"npm:simplehttpserver@0.0.6"`
  - `"npm:lodash@4.17.20"`
  - `"pypi:django@3.2.0"`

### PatchRecord Schema

Each patch has:

```typescript
{
  "uuid": string,              // UUID v4
  "exportedAt": string,        // ISO 8601 timestamp
  "files": {                   // Files modified by patch
    "<filepath>": {
      "beforeHash": string,    // Hash before patch
      "afterHash": string      // Hash after patch
    }
  },
  "vulnerabilities": {         // Vulnerabilities fixed
    "<GHSA-ID>": {
      "cves": string[],        // Related CVE IDs
      "summary": string,       // Short description
      "severity": string,      // LOW/MEDIUM/HIGH/CRITICAL
      "description": string    // Detailed explanation
    }
  },
  "description": string,       // Patch description
  "license": string,           // Patch license (MIT, etc.)
  "tier": string               // "free" or "premium"
}
```

## Complete Example

```json
{
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
          "description": "Lodash versions prior to 4.17.21 are vulnerable to command injection via the template function..."
        }
      },
      "description": "Fixes command injection vulnerability in template function",
      "license": "MIT",
      "tier": "free"
    },
    "npm:simplehttpserver@0.0.6": {
      "uuid": "fedcba98-7654-3210-fedc-ba9876543210",
      "exportedAt": "2025-01-14T13:30:00Z",
      "files": {
        "node_modules/simplehttpserver/index.js": {
          "beforeHash": "sha256-oldHash123...",
          "afterHash": "sha256-newHash456..."
        }
      },
      "vulnerabilities": {
        "GHSA-xxxx-yyyy-zzzz": {
          "cves": ["CVE-2024-12345"],
          "summary": "Path traversal vulnerability",
          "severity": "CRITICAL",
          "description": "Allows attackers to read arbitrary files..."
        }
      },
      "description": "Fixes path traversal in file serving",
      "license": "MIT",
      "tier": "free"
    }
  }
}
```

## Field Details

### PURL (Package URL)

**Format**: `<ecosystem>:<name>@<version>`

Examples:
- `npm:lodash@4.17.20`
- `npm:@types/node@14.14.31`
- `pypi:django@3.2.0`
- `maven:com.fasterxml.jackson.core/jackson-databind@2.12.0`

**Why PURL?**
- Standard format across ecosystems
- Uniquely identifies exact package version
- One patch per package version

### uuid

**Format**: UUID v4 (RFC 4122)

```json
"uuid": "123e4567-e89b-12d3-a456-426614174000"
```

**Purpose**:
- Unique identifier for the patch itself
- Links to backup metadata in `~/.socket/_patches/manifests/<uuid>.json`
- Used for restore/cleanup operations

### exportedAt

**Format**: ISO 8601 timestamp

```json
"exportedAt": "2025-01-14T12:00:00Z"
```

**Purpose**:
- When the patch was created/exported
- Not when it was applied (that's in backup metadata)

### files

**Format**: Record of filepath → hash pair

```json
"files": {
  "node_modules/lodash/lodash.js": {
    "beforeHash": "sha256-qUiQTy8...",
    "afterHash": "sha256-9f8e7d6..."
  }
}
```

**Key**: Relative file path from project root
**Values**:
- `beforeHash`: Hash of file content before patch (ssri format)
- `afterHash`: Hash of file content after patch (ssri format)

**Purpose**:
- Verify patch hasn't already been applied
- Detect conflicts with local modifications
- Validate patch application

**Hash Format**: Must be ssri format
- Current: `sha256-base64` (e.g., `sha256-qUiQTy8...`)
- Legacy: `git-sha256-hex` (for backward compatibility)

### vulnerabilities

**Format**: Record of GHSA ID → vulnerability details

```json
"vulnerabilities": {
  "GHSA-jrhj-2j3q-xf3v": {
    "cves": ["CVE-2021-23337"],
    "summary": "Command injection in lodash",
    "severity": "HIGH",
    "description": "Detailed explanation..."
  }
}
```

**Key**: GHSA identifier (GitHub Security Advisory)
**Values**:
- `cves`: Related CVE IDs (may be empty)
- `summary`: One-line description
- `severity`: LOW | MEDIUM | HIGH | CRITICAL
- `description`: Full explanation

**Purpose**:
- Document what vulnerabilities are fixed
- Help users understand why patch is needed
- Link to security advisories

### description

**Format**: String (human-readable)

```json
"description": "Fixes command injection vulnerability in template function"
```

**Purpose**: Explain what the patch does

### license

**Format**: SPDX license identifier

```json
"license": "MIT"
```

**Purpose**: License under which patch is provided

### tier

**Format**: "free" | "premium"

```json
"tier": "free"
```

**Purpose**: Indicates if patch requires Socket subscription

## Hash Format Migration

### Current Format (ssri)

```json
"beforeHash": "sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc="
```

**Benefits**:
- Standard format (W3C Subresource Integrity)
- Used by npm, pnpm, yarn lockfiles
- Self-describing (algorithm prefix)
- Compatible with cacache

### Legacy Format (git-sha256)

```json
"beforeHash": "git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d"
```

**Migration**:
- Detect format using `detectHashFormat()` from `utils/manifest/patches/hash.mts`
- Validate with appropriate function
- Convert to ssri when updating manifest
- Support both formats during transition

## Manifest Lifecycle

### 1. Initial State (No Patches)

```json
{
  "patches": {}
}
```

Or file doesn't exist yet.

### 2. After Applying First Patch

```json
{
  "patches": {
    "npm:lodash@4.17.20": {
      "uuid": "abc-123",
      "exportedAt": "2025-01-14T12:00:00Z",
      "files": { ... },
      "vulnerabilities": { ... },
      "description": "...",
      "license": "MIT",
      "tier": "free"
    }
  }
}
```

### 3. After Applying Second Patch

```json
{
  "patches": {
    "npm:lodash@4.17.20": { ... },
    "npm:express@4.17.1": { ... }
  }
}
```

### 4. After Removing Patch

Patch entry is removed:

```json
{
  "patches": {
    "npm:express@4.17.1": { ... }
  }
}
```

## Validation

Schema validation using Zod:

```typescript
import { PatchManifestSchema } from '@depscan/lib/security-patch/autopatcher/manifest-schema'

// Validate manifest
const result = PatchManifestSchema.safeParse(manifestData)
if (!result.success) {
  console.error('Invalid manifest:', result.error)
}
```

## Comparison with Backup Metadata

| Aspect | `.socket/manifest.json` | `~/.socket/_patches/manifests/<uuid>.json` |
|--------|------------------------|-------------------------------------------|
| **Location** | User's repo | Global Socket home |
| **Committed** | Yes (git tracked) | No (local only) |
| **Purpose** | Patch record | Backup metadata |
| **Scope** | All patches | Single patch |
| **Key** | PURL | UUID |
| **Contains** | Vulnerability info | Backup file info |
| **Shared** | Team sees it | Developer-specific |

### Example: Same Patch in Both Places

**`.socket/manifest.json`** (in repo):
```json
{
  "patches": {
    "npm:lodash@4.17.20": {
      "uuid": "abc-123",
      "files": {
        "node_modules/lodash/lodash.js": {
          "beforeHash": "sha256-qUiQTy8...",
          "afterHash": "sha256-9f8e7d6..."
        }
      },
      "vulnerabilities": { ... }
    }
  }
}
```

**`~/.socket/_patches/manifests/abc-123.json`** (local):
```json
{
  "uuid": "abc-123",
  "patchedAt": "2025-01-14T14:30:00Z",
  "files": {
    "node_modules/lodash/lodash.js": {
      "integrity": "sha256-qUiQTy8...",
      "size": 12345,
      "backedUpAt": "2025-01-14T14:30:00Z",
      "originalPath": "node_modules/lodash/lodash.js"
    }
  }
}
```

**Key Differences**:
- Manifest has `beforeHash` + `afterHash` (for verification)
- Backup has `integrity` only (original file hash)
- Manifest has vulnerability info
- Backup has file size and backup timestamp

## Operations

### Read Manifest

```typescript
import { readFile } from 'fs/promises'

const manifest = JSON.parse(
  await readFile('.socket/manifest.json', 'utf-8')
)
```

### Add Patch to Manifest

```typescript
manifest.patches[purl] = {
  uuid,
  exportedAt: new Date().toISOString(),
  files: { ... },
  vulnerabilities: { ... },
  description: '...',
  license: 'MIT',
  tier: 'free'
}

await writeFile(
  '.socket/manifest.json',
  JSON.stringify(manifest, null, 2)
)
```

### Remove Patch from Manifest

```typescript
delete manifest.patches[purl]

await writeFile(
  '.socket/manifest.json',
  JSON.stringify(manifest, null, 2)
)
```

### Check if Patch Applied

```typescript
const isApplied = purl in manifest.patches
```

## Best Practices

1. **Always commit manifest**: It's the source of truth
2. **Validate before write**: Use Zod schema
3. **Use ssri hashes**: Convert legacy formats
4. **Pretty print JSON**: Use `JSON.stringify(data, null, 2)`
5. **Handle missing file**: Empty patches object if new project
6. **Atomic writes**: Write to temp file, then rename

## Next Steps

Phase 1.2 will implement:
- `readManifest()` - Read and validate manifest
- `writeManifest()` - Write with validation
- `addPatch()` - Add patch to manifest
- `removePatch()` - Remove patch from manifest
- `getPatch()` - Get specific patch record
- `listPatches()` - List all applied patches
- `migrateHashes()` - Convert legacy git-sha256 to ssri

Ready to implement! 🚀
