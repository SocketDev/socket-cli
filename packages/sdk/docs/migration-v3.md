# Migration Guide: v2.x to v3.0

## Removed Methods

These methods have been removed. Use the modern full scan equivalents:

- `createScan()` → `createFullScan()`
- `deleteScan()` → `deleteFullScan()`
- `getScan()` → `getFullScan()`
- `listScans()` → `listFullScans()`

## Method Renames

### Full Scans

| v2.x | v3.0 |
|------|------|
| `getOrgFullScanList()` | `listFullScans()` |
| `createOrgFullScan()` | `createFullScan()` |
| `getOrgFullScanBuffered()` | `getFullScan()` |
| `deleteOrgFullScan()` | `deleteFullScan()` |
| `streamOrgFullScan()` | `streamFullScan()` |
| `getOrgFullScanMetadata()` | `getFullScanMetadata()` |

### Organizations

| v2.x | v3.0 |
|------|------|
| `getOrganizations()` | `listOrganizations()` |

### Repositories

| v2.x | v3.0 |
|------|------|
| `getOrgRepoList()` | `listRepositories()` |
| `getOrgRepo()` | `getRepository()` |
| `createOrgRepo()` | `createRepository()` |
| `updateOrgRepo()` | `updateRepository()` |
| `deleteOrgRepo()` | `deleteRepository()` |

## Search and Replace

```bash
# Full scans
getOrgFullScanList → listFullScans
createOrgFullScan → createFullScan
getOrgFullScanBuffered → getFullScan
deleteOrgFullScan → deleteFullScan
streamOrgFullScan → streamFullScan
getOrgFullScanMetadata → getFullScanMetadata

# Organizations
getOrganizations → listOrganizations

# Repositories
getOrgRepoList → listRepositories
getOrgRepo → getRepository
createOrgRepo → createRepository
updateOrgRepo → updateRepository
deleteOrgRepo → deleteRepository

# Removed - use full scan methods
createScan → createFullScan
deleteScan → deleteFullScan
getScan → getFullScan
listScans → listFullScans
```

## Type Changes

v3.0 marks guaranteed API fields as required instead of optional. Fields like `id` and `created_at` are now typed as `string` instead of `string | undefined`, improving IntelliSense.

New strict types available:
- `FullScanListResult`
- `FullScanResult`
- `OrganizationsResult`
- `RepositoriesListResult`
- `DeleteResult`
- `StrictErrorResult`
