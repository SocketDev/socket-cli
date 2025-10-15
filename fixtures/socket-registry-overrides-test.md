# Socket Registry Overrides Test Examples

This document shows example usage of the patch hash utilities for handling Socket patches.

## Hash Format Examples

### ssri Format (Current Standard)
```
sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=
sha512-7iaw3Ur350mqGo7jwQrpkj9hiYB3Lkc/iBml1JQODbJ6wYX4oOHV+E+IvIh/1nsUNzLDBMxfqa2Ob1f1ACio/w==
```

### git-sha256 Format (Legacy)
```
git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d
```

## Usage Examples

### Detecting Hash Format
```typescript
import { detectHashFormat } from '../src/utils/patch-hash.mts'

const format1 = detectHashFormat('sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=')
// Returns: 'ssri'

const format2 = detectHashFormat('git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d')
// Returns: 'git-sha256'
```

### Validating Content
```typescript
import { validateHash } from '../src/utils/patch-hash.mts'

const content = Buffer.from('hello world\n')
const ssriHash = 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='

const isValid = validateHash(content, ssriHash)
// Returns: true
```

### Converting Legacy Hashes
```typescript
import { normalizeToSsri } from '../src/utils/patch-hash.mts'

const content = Buffer.from('hello world\n')
const legacyHash = 'git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d'

const ssriHash = normalizeToSsri(content, legacyHash)
// Returns: 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='
```

### Computing New Hashes
```typescript
import { computeSsri } from '../src/utils/patch-hash.mts'

const content = Buffer.from('hello world\n')

const sha256Hash = computeSsri(content)
// Returns: 'sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc='

const sha512Hash = computeSsri(content, 'sha512')
// Returns: 'sha512-...'
```

## Migration Strategy

When reading existing manifests:
1. Detect hash format using `detectHashFormat()`
2. Validate hash using `validateHash()`
3. Convert legacy git-sha256 to ssri using `normalizeToSsri()`
4. Write back manifest with new ssri hashes

## Hash Format Comparison

| Format | Example | Use Case |
|--------|---------|----------|
| ssri (sha256) | `sha256-qUiQTy8PR5uPgZdpSzAYSw0u0cHNKh7A+4XSmaGSpEc=` | New patches, compatible with npm/pnpm/yarn lockfiles |
| ssri (sha512) | `sha512-7iaw3Ur350mqGo7jwQrpkj9hiYB3Lkc/iBml1JQODbJ6wYX4oOHV+E+IvIh/1nsUNzLDBMxfqa2Ob1f1ACio/w==` | Higher security requirements |
| git-sha256 | `git-sha256-0bd69098bd9b9cc5934a610ab65da429b525361147faa7b5b922919e9a23143d` | Legacy patches, GitHub compatibility |

## Key Differences

### Git SHA Format
- Includes `blob <size>\0` prefix before hashing
- Used by Git for object storage
- Supports both SHA-1 (40 hex) and SHA-256 (64 hex)

### ssri Format
- Pure content hash (no prefix)
- W3C Subresource Integrity standard
- Base64 encoded
- Self-describing with algorithm prefix

## Transition Period

During transition from git-sha256 to ssri:
- **Read**: Support both formats
- **Write**: Always use ssri format
- **Validate**: Accept both formats
- **Convert**: Normalize legacy hashes to ssri on read
