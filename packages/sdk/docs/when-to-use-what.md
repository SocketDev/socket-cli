# Method Reference

## Scans

| Task | Method | Notes |
|------|--------|-------|
| List scans | `listFullScans(orgSlug, options)` | Requires org slug |
| Create scan | `createFullScan(orgSlug, files, options)` | For CI/CD |
| Get scan | `getFullScan(orgSlug, scanId)` | Full scan data |
| Stream scan | `streamFullScan(orgSlug, scanId)` | For large SBOMs |
| Delete scan | `deleteFullScan(orgSlug, scanId)` | Remove scan |
| Scan metadata | `getFullScanMetadata(orgSlug, scanId)` | Quick status |

## Organizations

| Task | Method |
|------|--------|
| List orgs | `listOrganizations()` |

## Repositories

| Task | Method |
|------|--------|
| List repos | `listRepositories(orgSlug, options)` |
| Get repo | `getRepository(orgSlug, repoSlug)` |
| Create repo | `createRepository(orgSlug, data)` |
| Update repo | `updateRepository(orgSlug, repoSlug, data)` |
| Delete repo | `deleteRepository(orgSlug, repoSlug)` |

## Package Analysis

| Task | Method | Notes |
|------|--------|-------|
| Analyze multiple packages | `batchPackageFetch(options)` | Batch analysis |
| Stream package analysis | `batchPackageStream(options)` | For large batches |
| Get package issues | `getIssuesByNpmPackage(ecosystem, name, version)` | Security issues |
| Get package score | `getScoreByNpmPackage(ecosystem, name, version)` | Security score |

## Dependencies & SBOM

| Task | Method |
|------|--------|
| Create dependency snapshot | `createDependenciesSnapshot(files, options)` |
| Upload manifests | `uploadManifestFiles(orgSlug, files, options)` |
| Export CycloneDX | `exportCDX(orgSlug, scanId)` |
| Export SPDX | `exportSPDX(orgSlug, scanId)` |
| Search dependencies | `searchDependencies(orgSlug, query, options)` |

## Security Policies

| Task | Method |
|------|--------|
| Get security policy | `getOrgSecurityPolicy(orgSlug)` |
| Update security policy | `updateOrgSecurityPolicy(orgSlug, rules)` |
| Get license policy | `getOrgLicensePolicy(orgSlug)` |
| Update license policy | `updateOrgLicensePolicy(orgSlug, rules)` |

## Diff Scans

| Task | Method |
|------|--------|
| List diffs | `listOrgDiffScans(orgSlug, options)` |
| Create diff | `createOrgDiffScanFromIds(orgSlug, { base_scan_id, head_scan_id })` |
| Get diff | `getDiffScanById(orgSlug, diffId)` |
| Delete diff | `deleteOrgDiffScan(orgSlug, diffId)` |
