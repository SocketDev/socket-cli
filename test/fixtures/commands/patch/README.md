# Patch Command Test Fixtures

This directory contains test fixtures for the `socket patch` command suite.

## Fixture Directories

### `npm/`, `pnpm/`, `yarn/`
Package manager specific fixtures with minimal manifests containing only required fields:
- `exportedAt` (required)
- `files` (required)
- `vulnerabilities` (required in old schema, now optional)

These fixtures are used to test basic functionality across different package managers.

**Example Package**: `pkg:npm/on-headers@1.0.2`

### `complete/`
Comprehensive fixture with all optional fields populated. Used to test complete output formatting.

**Packages**:
- `pkg:npm/example-package@1.2.3` - Full metadata with multiple vulnerabilities
- `pkg:npm/another-package@2.0.0` - Full metadata with no vulnerabilities
- `pkg:npm/minimal-package@0.1.0` - Only required fields (for comparison)

**Optional Fields Tested**:
- `uuid` - Unique identifier for backup/restore operations
- `description` - Human-readable description of the patch
- `tier` - Patch tier level (e.g., "free", "premium")
- `license` - License of the patch
- `vulnerabilities` - Vulnerabilities fixed by the patch (now optional)

### `no-vulns/`
Fixture demonstrating patches without vulnerability information. Used to test the optional `vulnerabilities` field.

**Packages**:
- `pkg:npm/perf-patch@3.0.0` - Performance patch with full metadata, no vulnerabilities
- `pkg:npm/feature-patch@1.0.0` - Feature patch with minimal metadata, no vulnerabilities

## Manifest Schema

All manifests follow the `PatchManifestSchema`:

```typescript
{
  patches: {
    [purl: string]: {
      exportedAt: string              // Required: ISO 8601 timestamp
      files: {                        // Required: File patches
        [path: string]: {
          beforeHash: string          // SHA256 before patching
          afterHash: string           // SHA256 after patching
        }
      }
      uuid?: string                   // Optional: Backup identifier
      description?: string            // Optional: Patch description
      tier?: string                   // Optional: Tier level
      license?: string                // Optional: License
      vulnerabilities?: {             // Optional: Vulnerabilities fixed
        [ghsaId: string]: {
          cves: string[]
          summary: string
          severity: string
          description: string
          patchExplanation: string
        }
      }
    }
  }
}
```

## Testing Different Scenarios

### Test Basic Functionality
Use `npm/`, `pnpm/`, or `yarn/` fixtures:
- Minimal required fields
- Single vulnerability
- Package manager specific testing

### Test Complete Output
Use `complete/` fixture:
- All optional fields populated
- Multiple vulnerabilities
- Various tier levels
- Different licenses
- Multiple files per patch

### Test Optional Vulnerabilities
Use `no-vulns/` fixture:
- Patches without vulnerability information
- Tests schema validation with optional `vulnerabilities` field
- Performance and feature patches (non-security)

## Usage in Tests

```typescript
import path from 'node:path'

const fixtureBaseDir = path.join(testPath, 'fixtures/commands/patch')
const completeFixture = path.join(fixtureBaseDir, 'complete')
const noVulnsFixture = path.join(fixtureBaseDir, 'no-vulns')
const pnpmFixture = path.join(fixtureBaseDir, 'pnpm')
```

## Expected Output Behavior

### Fields Always Shown
- `purl` - Package identifier
- `Exported` - Export timestamp
- `Files` - File count
- `Vulnerabilities` - Vulnerability count (0 if no vulnerabilities)
- `Description` - Shows "No description provided" if missing

### Fields Only Shown When Present
- `UUID` - Only if provided
- `Tier` - Only if provided
- `License` - Only if provided

### JSON Output
Undefined optional fields are omitted from JSON output for cleaner results.

### Markdown Output
All fields shown with fallback text for missing optional fields.
