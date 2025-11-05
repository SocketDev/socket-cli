# @socketsecurity/sdk

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketsecurity/sdk)](https://socket.dev/npm/package/@socketsecurity/sdk)
[![CI](https://github.com/SocketDev/socket-sdk-js/actions/workflows/ci.yml/badge.svg)](https://github.com/SocketDev/socket-sdk-js/actions/workflows/ci.yml)
![Test Coverage](https://img.shields.io/badge/test--coverage-95%25-brightgreen)
![Type Coverage](https://img.shields.io/badge/type--coverage-100%25-brightgreen)

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

JavaScript SDK for [Socket.dev](https://socket.dev/) API - Security analysis, vulnerability scanning, and compliance monitoring for software supply chains.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Methods](#api-methods) - [Full API Reference](./docs/api-reference.md)
- [Documentation](#documentation)
- [Examples](#examples)

## At a Glance

| Feature | Description |
|---------|-------------|
| **Package Analysis** | Quick security checks for npm packages |
| **Full Scans** | Deep analysis with SBOM support |
| **Batch Operations** | Analyze multiple packages efficiently |
| **Policy Management** | Configure security & license rules |
| **Quota Utilities** | Cost calculation & planning helpers |
| **TypeScript** | Full type safety with auto-generated types |

**Requirements:** Node.js 18+ ·ESM only (v2.0+)

## Installation

```bash
pnpm add @socketsecurity/sdk
```

**Note:** Version 2.0+ is ESM-only. For CommonJS support, use version 1.x.

## Quick Start

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key', {
  retries: 3,        // Retry failed requests up to 3 times
  retryDelay: 1000,  // Start with 1s delay, exponential backoff
  timeout: 30000,    // 30 second timeout
})

// Check your quota
const quota = await client.getQuota()
if (quota.success) {
  console.log(`Available quota: ${quota.data.quota} units`)
}

// Analyze a package
const result = await client.getScoreByNpmPackage('express', '4.18.0')
if (result.success) {
  console.log(`Security Score: ${result.data.score}/100`)
}

// Batch analyze multiple packages
const batchResult = await client.batchPackageFetch({
  components: [
    { purl: 'pkg:npm/express@4.18.0' },
    { purl: 'pkg:npm/react@18.0.0' }
  ]
})
```

**[→ Configuration](./docs/api-reference.md#configuration)**

## API Methods

### Package Analysis

Quick security checks: `batchPackageFetch()` ·`batchPackageStream()` ·`getIssuesByNpmPackage()` ·`getScoreByNpmPackage()`

[→ Documentation](./docs/api-reference.md#package-analysis)

### Scanning & Analysis

Project scanning: `createDependenciesSnapshot()` ·`createOrgFullScan()` ·`createScanFromFilepaths()` ·`getScan()` ·`getScanList()` ·`getSupportedScanFiles()`

[→ Documentation](./docs/api-reference.md#scanning--analysis)

### Organization Management

Organizations and repositories: `getOrganizations()` ·`createOrgRepo()` ·`getOrgRepo()` ·`getOrgRepoList()` ·`updateOrgRepo()` ·`deleteOrgRepo()`

[→ Documentation](./docs/api-reference.md#organization-management)

### Policy & Settings

Security configuration: `getOrgSecurityPolicy()` ·`updateOrgSecurityPolicy()` ·`getOrgLicensePolicy()` ·`updateOrgLicensePolicy()` ·`postSettings()`

[→ Documentation](./docs/api-reference.md#policy--settings)

### Full Scan Management

Deep analysis: `getOrgFullScanList()` ·`getOrgFullScanMetadata()` ·`getOrgFullScanBuffered()` ·`streamOrgFullScan()` ·`deleteOrgFullScan()`

[→ Documentation](./docs/api-reference.md#full-scan-management)

### Diff Scans

Scan comparison: `createOrgDiffScanFromIds()` ·`getDiffScanById()` ·`listOrgDiffScans()` ·`deleteOrgDiffScan()`

[→ Documentation](./docs/api-reference.md#diff-scans)

### Patches & Vulnerabilities

Security fixes: `streamPatchesFromScan()` ·`viewPatch()`

[→ Documentation](./docs/api-reference.md#patches--vulnerabilities)

### Alert & Triage

Alert management: `getOrgTriage()` ·`updateOrgAlertTriage()`

[→ Documentation](./docs/api-reference.md#alert--triage)

### Export & Integration

SBOM export: `exportCDX()` ·`exportSPDX()` ·`searchDependencies()` ·`uploadManifestFiles()`

[→ Documentation](./docs/api-reference.md#export--integration)

### Repository Labels

Categorization: `createOrgRepoLabel()` ·`getOrgRepoLabel()` ·`getOrgRepoLabelList()` ·`updateOrgRepoLabel()` ·`deleteOrgRepoLabel()`

[→ Documentation](./docs/api-reference.md#repository-labels)

### Analytics & Monitoring

Usage metrics: `getQuota()` ·`getOrgAnalytics()` ·`getRepoAnalytics()` ·`getAuditLogEvents()`

[→ Documentation](./docs/api-reference.md#analytics--monitoring)

### Authentication & Access

API tokens: `getAPITokens()` ·`postAPIToken()` ·`postAPITokensRotate()` ·`postAPITokensRevoke()` ·`postAPITokenUpdate()`

[→ Documentation](./docs/api-reference.md#authentication--access)

### Entitlements

Feature access: `getEnabledEntitlements()` ·`getEntitlements()`

[→ Documentation](./docs/api-reference.md#entitlements)

### Quota Utilities

Cost helpers: `getQuotaCost()` ·`getRequiredPermissions()` ·`calculateTotalQuotaCost()` ·`hasQuotaForMethods()` ·`getMethodsByQuotaCost()` ·`getMethodsByPermissions()` ·`getQuotaUsageSummary()` ·`getAllMethodRequirements()`

[→ Documentation](./docs/quota-management.md)

### Advanced Query Methods

Raw API access: `getApi()` ·`sendApi()`

[→ Documentation](./docs/api-reference.md#advanced-query-methods)

## Documentation

| Guide | Description |
|-------|-------------|
| **[Getting Started](./docs/getting-started.md)** | Quick start for contributors (5 min setup) |
| **[API Reference](./docs/api-reference.md)** | Complete API method documentation |
| **[Usage Examples](./docs/usage-examples.md)** | Real-world patterns and code samples |
| **[Quota Management](./docs/quota-management.md)** | Cost tiers (0/10/100) and utilities |
| **[Testing Guide](./docs/dev/testing.md)** | Test helpers, fixtures, and patterns |
| **[Method Reference](./docs/when-to-use-what.md)** | Quick method selection guide |

## Examples

See **[usage-examples.md](./docs/usage-examples.md)** for complete examples including:
- Package security analysis
- Batch operations
- Full scans with SBOM
- Policy management
- Quota planning

## Related Projects

| Project | Description |
|---------|-------------|
| [Socket.dev API](https://docs.socket.dev/reference) | Official REST API documentation |
| [Socket CLI](https://github.com/SocketDev/socket-cli) | Command-line interface |
| [Socket GitHub App](https://github.com/apps/socket-security) | Automated GitHub integration |

## License

MIT
