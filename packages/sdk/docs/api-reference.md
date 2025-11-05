# API Reference

API reference for `@socketsecurity/sdk`. All methods return a result object:

```typescript
// Success result
{
  success: true,
  status: number,
  data: T
}

// Error result
{
  success: false,
  status: number,
  error: string,
  cause?: string
}
```

## Package Analysis

#### `batchPackageFetch(componentsObj, queryParams?)`

Analyze multiple packages in a single batch request. Returns all results after processing completes.

**Parameters:**
- `componentsObj` - Object containing array of package components with PURLs
- `queryParams?` - Optional query parameters for filtering/configuration

**Returns:** Promise resolving to array of package analysis results

<details>
<summary>Show example</summary>

```typescript
const result = await client.batchPackageFetch({
  components: [
    { purl: 'pkg:npm/express@4.18.0' },
    { purl: 'pkg:npm/lodash@4.17.21' }
  ]
})

if (result.success) {
  for (const pkg of result.data) {
    console.log(`${pkg.name}: Score ${pkg.score}`)
  }
}
```

</details>

---

#### `batchPackageStream(componentsObj, options?)`

Stream package analysis with concurrency control via async generator.

**Parameters:**
- `componentsObj` - Object containing array of package components
- `options?` - Streaming options with concurrency control

**Returns:** AsyncGenerator yielding package results

<details>
<summary>Show example</summary>

```typescript
const stream = client.batchPackageStream({
  components: [
    { purl: 'pkg:npm/express@4.18.0' },
    { purl: 'pkg:npm/react@18.0.0' }
  ]
}, { concurrency: 5 })

for await (const result of stream) {
  if (result.success) {
    console.log(`Analyzed: ${result.data.name}`)
  }
}
```

</details>

---

#### `getIssuesByNpmPackage(packageName, version)`

Get security issues for an npm package version.

**Parameters:**
- `packageName` - Package name (e.g., 'express')
- `version` - Specific version (e.g., '4.18.0')

**Returns:** Promise with vulnerability and security alert information

<details>
<summary>Show example</summary>

```typescript
const result = await client.getIssuesByNpmPackage('express', '4.18.0')

if (result.success) {
  console.log(`Found ${result.data.issues.length} issues`)
  for (const issue of result.data.issues) {
    console.log(`${issue.type}: ${issue.severity}`)
  }
}
```

</details>

---

#### `getScoreByNpmPackage(packageName, version)`

Get security score for a package.

**Parameters:**
- `packageName` - Package name
- `version` - Package version

**Returns:** Promise with numerical security rating

<details>
<summary>Show example</summary>

```typescript
const result = await client.getScoreByNpmPackage('lodash', '4.17.21')

if (result.success) {
  console.log(`Security Score: ${result.data.score}/100`)
  console.log(`Supply Chain: ${result.data.supplyChainRisk}`)
}
```

</details>

## Scanning & Analysis

#### `createDependenciesSnapshot(filepaths, pathsRelativeTo?, queryParams?)`

Create dependency snapshot from project files.

**Parameters:**
- `filepaths` - Array of file paths to analyze
- `pathsRelativeTo?` - Base directory for relative paths (default: '.')
- `queryParams?` - Additional query parameters

**Returns:** Promise with snapshot creation result

<details>
<summary>Show example</summary>

```typescript
const result = await client.createDependenciesSnapshot(
  ['package.json', 'package-lock.json'],
  '/path/to/project'
)

if (result.success) {
  console.log(`Snapshot ID: ${result.data.id}`)
}
```

</details>

---

#### `createOrgFullScan(orgSlug, filepaths, pathsRelativeTo?, queryParams?)`

Create full security scan for organization.

**Parameters:**
- `orgSlug` - Organization identifier
- `filepaths` - Array of project files to scan
- `pathsRelativeTo?` - Base directory (default: '.')
- `queryParams?` - Scan configuration options

**Returns:** Promise with scan creation result

<details>
<summary>Show example</summary>

```typescript
const result = await client.createOrgFullScan(
  'my-org',
  ['package.json', 'src/**/*.js'],
  '/path/to/project',
  { branch: 'main' }
)

if (result.success) {
  console.log(`Scan started: ${result.data.id}`)
}
```

</details>

---

#### `getScan(id)`

Retrieve complete scan results by scan ID.

**Parameters:**
- `id` - Scan identifier

**Returns:** Promise with complete scan analysis

<details>
<summary>Show example</summary>

```typescript
const result = await client.getScan('scan_abc123')

if (result.success) {
  console.log(`Status: ${result.data.status}`)
  console.log(`Issues: ${result.data.issues.length}`)
}
```

</details>

---

#### `getScanList()`

List all accessible scans with pagination support.

**Returns:** Promise with paginated list of scan metadata

<details>
<summary>Show example</summary>

```typescript
const result = await client.getScanList()

if (result.success) {
  for (const scan of result.data.scans) {
    console.log(`${scan.id}: ${scan.status}`)
  }
}
```

</details>

---

#### `getSupportedScanFiles()`

Get list of supported manifest files and formats.

**Returns:** Promise with supported file types

<details>
<summary>Show example</summary>

```typescript
const result = await client.getSupportedScanFiles()

if (result.success) {
  console.log('Supported files:', result.data.files)
}
```

</details>

## Organization Management

#### `getOrganizations()`

List all accessible organizations with permissions.

**Returns:** Promise with organization list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrganizations()

if (result.success) {
  for (const org of result.data.organizations) {
    console.log(`${org.name} (${org.plan})`)
  }
}
```

</details>

---

#### `createOrgRepo(orgSlug, queryParams?)`

Create a new repository for monitoring.

**Parameters:**
- `orgSlug` - Organization identifier
- `queryParams?` - Repository configuration

**Returns:** Promise with created repository details

<details>
<summary>Show example</summary>

```typescript
const result = await client.createOrgRepo('my-org', {
  name: 'my-repo',
  homepage: 'https://github.com/org/repo',
  default_branch: 'main'
})

if (result.success) {
  console.log(`Repository created: ${result.data.id}`)
}
```

</details>

---

#### `getOrgRepo(orgSlug, repoSlug)`

Get repository details and configuration.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier

**Returns:** Promise with repository details

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgRepo('my-org', 'my-repo')

if (result.success) {
  console.log(`Repo: ${result.data.name}`)
  console.log(`Branch: ${result.data.default_branch}`)
}
```

</details>

---

#### `getOrgRepoList(orgSlug, queryParams?)`

List all repositories in an organization.

**Parameters:**
- `orgSlug` - Organization identifier
- `queryParams?` - Filtering and pagination options

**Returns:** Promise with repository list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgRepoList('my-org', {
  archived: false,
  limit: 50
})

if (result.success) {
  console.log(`Found ${result.data.repositories.length} repos`)
}
```

</details>

---

#### `updateOrgRepo(orgSlug, repoSlug, queryParams?)`

Update repository configuration and settings.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier
- `queryParams?` - Updated configuration

**Returns:** Promise with updated repository details

<details>
<summary>Show example</summary>

```typescript
const result = await client.updateOrgRepo('my-org', 'my-repo', {
  archived: true,
  homepage: 'https://new-url.com'
})

if (result.success) {
  console.log('Repository updated successfully')
}
```

</details>

---

#### `deleteOrgRepo(orgSlug, repoSlug)`

Delete a repository and its associated data.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier

**Returns:** Promise with deletion confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.deleteOrgRepo('my-org', 'old-repo')

if (result.success) {
  console.log('Repository deleted')
}
```

</details>

## Full Scan Management

#### `getOrgFullScanList(orgSlug, queryParams?)`

List all full scans for an organization.

**Parameters:**
- `orgSlug` - Organization identifier
- `queryParams?` - Filtering options

**Returns:** Promise with scan list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgFullScanList('my-org', {
  limit: 20,
  status: 'completed'
})

if (result.success) {
  for (const scan of result.data.scans) {
    console.log(`${scan.id}: ${scan.created_at}`)
  }
}
```

</details>

---

#### `getOrgFullScanMetadata(orgSlug, fullScanId)`

Get metadata for a specific full scan.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier

**Returns:** Promise with scan metadata

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgFullScanMetadata('my-org', 'scan_123')

if (result.success) {
  console.log(`Status: ${result.data.status}`)
  console.log(`Files: ${result.data.file_count}`)
}
```

</details>

---

#### `getOrgFullScanBuffered(orgSlug, fullScanId)`

Get complete scan results loaded into memory.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier

**Returns:** Promise with complete scan data

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgFullScanBuffered('my-org', 'scan_123')

if (result.success) {
  // Process entire scan data
  console.log(`Total packages: ${result.data.packages.length}`)
}
```

</details>

---

#### `streamOrgFullScan(orgSlug, fullScanId, output?)`

Stream large scan results efficiently.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier
- `output?` - Output destination (file path or writable stream)

**Returns:** Promise with streaming result

<details>
<summary>Show example</summary>

```typescript
// Stream to file
await client.streamOrgFullScan('my-org', 'scan_123', '/tmp/scan-data.json')

// Stream to stdout
await client.streamOrgFullScan('my-org', 'scan_123', process.stdout)

// Get as ReadableStream
const result = await client.streamOrgFullScan('my-org', 'scan_123')
if (result.success) {
  for await (const chunk of result.data) {
    console.log(chunk)
  }
}
```

</details>

---

#### `deleteOrgFullScan(orgSlug, fullScanId)`

Delete a full scan and its data.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier

**Returns:** Promise with deletion confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.deleteOrgFullScan('my-org', 'scan_old')

if (result.success) {
  console.log('Scan deleted')
}
```

</details>

## Policy & Settings

#### `getOrgSecurityPolicy(orgSlug)`

Get organization security policy configuration.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with security policy

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgSecurityPolicy('my-org')

if (result.success) {
  console.log('Alert rules:', result.data.securityPolicyRules)
}
```

</details>

---

#### `updateOrgSecurityPolicy(orgSlug, policyData)`

Update security policy rules and settings.

**Parameters:**
- `orgSlug` - Organization identifier
- `policyData` - Updated policy configuration

**Returns:** Promise with update confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.updateOrgSecurityPolicy('my-org', {
  securityPolicyRules: {
    malware: { action: 'error' },
    vulnerability: { action: 'warn' }
  }
})

if (result.success) {
  console.log('Policy updated')
}
```

</details>

---

#### `getOrgLicensePolicy(orgSlug)`

Get license policy configuration.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with license policy

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgLicensePolicy('my-org')

if (result.success) {
  console.log('Allowed licenses:', result.data.allowed)
  console.log('Restricted licenses:', result.data.restricted)
}
```

</details>

---

#### `updateOrgLicensePolicy(orgSlug, policyData, queryParams?)`

Update license policy settings.

**Parameters:**
- `orgSlug` - Organization identifier
- `policyData` - Updated license policy
- `queryParams?` - Additional options

**Returns:** Promise with update confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.updateOrgLicensePolicy('my-org', {
  allowed: ['MIT', 'Apache-2.0'],
  restricted: ['GPL-3.0']
})

if (result.success) {
  console.log('License policy updated')
}
```

</details>

## Analytics & Monitoring

#### `getQuota()`

Get current API quota usage and limits.

**Returns:** Promise with quota information

<details>
<summary>Show example</summary>

```typescript
const result = await client.getQuota()

if (result.success) {
  console.log(`Remaining: ${result.data.quota}`)
  console.log(`Reset: ${result.data.reset}`)
}
```

</details>

---

#### `getOrgAnalytics(time)`

Get organization analytics for a time period.

**Parameters:**
- `time` - Time period ('7d', '30d', '90d')

**Returns:** Promise with analytics data

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgAnalytics('30d')

if (result.success) {
  for (const day of result.data) {
    console.log(`${day.date}: ${day.scans} scans`)
  }
}
```

</details>

---

#### `getRepoAnalytics(repo, time)`

Get repository-specific analytics.

**Parameters:**
- `repo` - Repository identifier
- `time` - Time period

**Returns:** Promise with repository analytics

<details>
<summary>Show example</summary>

```typescript
const result = await client.getRepoAnalytics('my-repo', '7d')

if (result.success) {
  console.log(`Commits: ${result.data.total_commits}`)
  console.log(`Issues fixed: ${result.data.issues_fixed}`)
}
```

</details>

---

#### `getAuditLogEvents(orgSlug, queryParams?)`

Get audit log events for an organization.

**Parameters:**
- `orgSlug` - Organization identifier
- `queryParams?` - Filtering options

**Returns:** Promise with audit log entries

<details>
<summary>Show example</summary>

```typescript
const result = await client.getAuditLogEvents('my-org', {
  limit: 100,
  from: '2024-01-01'
})

if (result.success) {
  for (const event of result.data.events) {
    console.log(`${event.timestamp}: ${event.action}`)
  }
}
```

</details>

## Authentication & Access

#### `getAPITokens(orgSlug)`

List organization API tokens.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with token list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getAPITokens('my-org')

if (result.success) {
  for (const token of result.data.tokens) {
    console.log(`${token.name}: ${token.created_at}`)
  }
}
```

</details>

---

#### `postAPIToken(orgSlug, tokenData)`

Create a new API token.

**Parameters:**
- `orgSlug` - Organization identifier
- `tokenData` - Token configuration

**Returns:** Promise with created token details

<details>
<summary>Show example</summary>

```typescript
const result = await client.postAPIToken('my-org', {
  name: 'CI Token',
  scopes: ['read:scans', 'write:scans']
})

if (result.success) {
  console.log(`Token: ${result.data.token}`)
  console.log('Save this token securely - it will not be shown again')
}
```

</details>

---

#### `postAPITokensRotate(orgSlug, tokenId)`

Rotate an existing API token.

**Parameters:**
- `orgSlug` - Organization identifier
- `tokenId` - Token identifier

**Returns:** Promise with new token value

<details>
<summary>Show example</summary>

```typescript
const result = await client.postAPITokensRotate('my-org', 'token_123')

if (result.success) {
  console.log(`New token: ${result.data.token}`)
}
```

</details>

---

#### `postAPITokensRevoke(orgSlug, tokenId)`

Revoke an API token.

**Parameters:**
- `orgSlug` - Organization identifier
- `tokenId` - Token identifier

**Returns:** Promise with revocation confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.postAPITokensRevoke('my-org', 'token_old')

if (result.success) {
  console.log('Token revoked')
}
```

</details>

## Export & Integration

#### `exportCDX(orgSlug, fullScanId)`

Export CycloneDX SBOM for a scan.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier

**Returns:** Promise with CycloneDX SBOM

<details>
<summary>Show example</summary>

```typescript
const result = await client.exportCDX('my-org', 'scan_123')

if (result.success) {
  fs.writeFileSync('sbom.json', JSON.stringify(result.data, null, 2))
}
```

</details>

---

#### `exportSPDX(orgSlug, fullScanId)`

Export SPDX SBOM for a scan.

**Parameters:**
- `orgSlug` - Organization identifier
- `fullScanId` - Full scan identifier

**Returns:** Promise with SPDX SBOM

<details>
<summary>Show example</summary>

```typescript
const result = await client.exportSPDX('my-org', 'scan_123')

if (result.success) {
  fs.writeFileSync('sbom-spdx.json', JSON.stringify(result.data, null, 2))
}
```

</details>

---

#### `uploadManifestFiles(orgSlug, filepaths, pathsRelativeTo?)`

Upload manifest files for dependency analysis.

**Parameters:**
- `orgSlug` - Organization identifier
- `filepaths` - Array of file paths
- `pathsRelativeTo?` - Base directory

**Returns:** Promise with upload result

<details>
<summary>Show example</summary>

```typescript
const result = await client.uploadManifestFiles(
  'my-org',
  ['package.json', 'package-lock.json'],
  '/path/to/project'
)

if (result.success) {
  console.log(`Tar hash: ${result.data.tarHash}`)
}
```

</details>

## Diff Scans

#### `createOrgDiffScanFromIds(orgSlug, queryParams?)`

Create a diff scan comparing two full scans.

**Parameters:**
- `orgSlug` - Organization identifier
- `queryParams?` - Scan IDs to compare

**Returns:** Promise with diff scan creation result

<details>
<summary>Show example</summary>

```typescript
const result = await client.createOrgDiffScanFromIds('my-org', {
  from: 'scan_old',
  to: 'scan_new'
})

if (result.success) {
  console.log(`Diff scan created: ${result.data.id}`)
}
```

</details>

---

#### `getDiffScanById(orgSlug, diffScanId)`

Get diff scan results.

**Parameters:**
- `orgSlug` - Organization identifier
- `diffScanId` - Diff scan identifier

**Returns:** Promise with diff scan results

<details>
<summary>Show example</summary>

```typescript
const result = await client.getDiffScanById('my-org', 'diff_123')

if (result.success) {
  console.log(`Added packages: ${result.data.added.length}`)
  console.log(`Removed packages: ${result.data.removed.length}`)
  console.log(`Changed packages: ${result.data.changed.length}`)
}
```

</details>

---

#### `listOrgDiffScans(orgSlug)`

List all diff scans for an organization.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with diff scan list

<details>
<summary>Show example</summary>

```typescript
const result = await client.listOrgDiffScans('my-org')

if (result.success) {
  for (const diff of result.data.diffs) {
    console.log(`${diff.id}: ${diff.from} → ${diff.to}`)
  }
}
```

</details>

---

#### `deleteOrgDiffScan(orgSlug, diffScanId)`

Delete a diff scan.

**Parameters:**
- `orgSlug` - Organization identifier
- `diffScanId` - Diff scan identifier

**Returns:** Promise with deletion confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.deleteOrgDiffScan('my-org', 'diff_old')

if (result.success) {
  console.log('Diff scan deleted')
}
```

</details>

## Alert & Triage

#### `getOrgTriage(orgSlug)`

Get organization triage settings and alert states.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with triage configuration

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgTriage('my-org')

if (result.success) {
  console.log('Triage settings:', result.data)
}
```

</details>

---

#### `updateOrgAlertTriage(orgSlug, alertId, triageData)`

Update alert triage status and resolution.

**Parameters:**
- `orgSlug` - Organization identifier
- `alertId` - Alert identifier
- `triageData` - Updated triage information

**Returns:** Promise with update confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.updateOrgAlertTriage('my-org', 'alert_123', {
  status: 'resolved',
  resolution: 'false_positive',
  notes: 'Verified as safe dependency'
})

if (result.success) {
  console.log('Alert triage updated')
}
```

</details>

## Repository Labels

#### `getOrgRepoLabelList(orgSlug, repoSlug)`

List all labels for a repository.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier

**Returns:** Promise with label list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgRepoLabelList('my-org', 'my-repo')

if (result.success) {
  for (const label of result.data.labels) {
    console.log(`${label.name}: ${label.color}`)
  }
}
```

</details>

---

#### `getOrgRepoLabel(orgSlug, repoSlug, labelSlug)`

Get details for a specific label.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier
- `labelSlug` - Label identifier

**Returns:** Promise with label details

<details>
<summary>Show example</summary>

```typescript
const result = await client.getOrgRepoLabel('my-org', 'my-repo', 'critical')

if (result.success) {
  console.log(`Label: ${result.data.name}`)
  console.log(`Color: ${result.data.color}`)
}
```

</details>

---

#### `createOrgRepoLabel(orgSlug, repoSlug, labelData)`

Create a new repository label.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier
- `labelData` - Label configuration

**Returns:** Promise with created label

<details>
<summary>Show example</summary>

```typescript
const result = await client.createOrgRepoLabel('my-org', 'my-repo', {
  name: 'high-priority',
  color: '#ff0000',
  description: 'High priority repositories'
})

if (result.success) {
  console.log(`Label created: ${result.data.id}`)
}
```

</details>

---

#### `updateOrgRepoLabel(orgSlug, repoSlug, labelSlug, labelData)`

Update an existing label.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier
- `labelSlug` - Label identifier
- `labelData` - Updated label data

**Returns:** Promise with updated label

<details>
<summary>Show example</summary>

```typescript
const result = await client.updateOrgRepoLabel('my-org', 'my-repo', 'critical', {
  color: '#ff6600',
  description: 'Updated description'
})

if (result.success) {
  console.log('Label updated')
}
```

</details>

---

#### `deleteOrgRepoLabel(orgSlug, repoSlug, labelSlug)`

Delete a repository label.

**Parameters:**
- `orgSlug` - Organization identifier
- `repoSlug` - Repository identifier
- `labelSlug` - Label identifier

**Returns:** Promise with deletion confirmation

<details>
<summary>Show example</summary>

```typescript
const result = await client.deleteOrgRepoLabel('my-org', 'my-repo', 'old-label')

if (result.success) {
  console.log('Label deleted')
}
```

</details>

## Patches & Vulnerabilities

#### `viewPatch(orgSlug, uuid)`

View detailed information about a security patch.

**Parameters:**
- `orgSlug` - Organization identifier
- `uuid` - Patch UUID

**Returns:** Promise with patch details

<details>
<summary>Show example</summary>

```typescript
const result = await client.viewPatch('my-org', 'patch_uuid_123')

if (result.success) {
  console.log(`Patch: ${result.data.description}`)
  console.log(`Published: ${result.data.publishedAt}`)
  console.log(`Tier: ${result.data.tier}`)

  for (const [cve, vuln] of Object.entries(result.data.vulnerabilities)) {
    console.log(`${cve}: ${vuln.description}`)
  }
}
```

</details>

---

#### `streamPatchesFromScan(orgSlug, scanId)`

Stream available patches from a scan.

**Parameters:**
- `orgSlug` - Organization identifier
- `scanId` - Scan identifier

**Returns:** ReadableStream of patch data

<details>
<summary>Show example</summary>

```typescript
const result = await client.streamPatchesFromScan('my-org', 'scan_123')

if (result.success) {
  const patches = []
  for await (const chunk of result.data) {
    patches.push(chunk)
  }
  console.log(`Found ${patches.length} available patches`)
}
```

</details>

## Entitlements

#### `getEntitlements(orgSlug)`

Get all organization entitlements with status.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with complete entitlements list

<details>
<summary>Show example</summary>

```typescript
const result = await client.getEntitlements('my-org')

if (result.success) {
  for (const entitlement of result.data.items) {
    console.log(`${entitlement.key}: ${entitlement.enabled ? 'enabled' : 'disabled'}`)
  }
}
```

</details>

---

#### `getEnabledEntitlements(orgSlug)`

Get only enabled entitlements for an organization.

**Parameters:**
- `orgSlug` - Organization identifier

**Returns:** Promise with enabled entitlements array

<details>
<summary>Show example</summary>

```typescript
const result = await client.getEnabledEntitlements('my-org')

if (result.success) {
  console.log('Enabled products:', result.data.join(', '))
}
```

</details>

## Advanced Query Methods

#### `getApi<T>(urlPath, options?)`

Execute a raw GET request with full control.

**Parameters:**
- `urlPath` - API endpoint path
- `options?` - Request options (responseType, throws)

**Returns:** Promise with configurable response type

<details>
<summary>Show example</summary>

```typescript
// Get JSON response
const result = await client.getApi<MyType>('/custom/endpoint', {
  responseType: 'json'
})

// Get raw Response object
const response = await client.getApi('/data', {
  responseType: 'response'
})

// Get text response
const text = await client.getApi('/text', {
  responseType: 'text'
})
```

</details>

---

#### `sendApi<T>(urlPath, options?)`

Send POST/PUT with JSON body.

**Parameters:**
- `urlPath` - API endpoint path
- `options?` - Request options (method, body, throws)

**Returns:** Promise with JSON response

<details>
<summary>Show example</summary>

```typescript
const result = await client.sendApi('/custom/action', {
  method: 'POST',
  body: { action: 'process', data: 'value' }
})

if (result.success) {
  console.log('Action completed:', result.data)
}
```

</details>

## See Also

- [Examples](./usage-examples.md) - Usage examples and patterns
- [Quota Management](./quota-management.md) - Quota utilities and cost management
- [Testing Utilities](./dev/testing.md) - Testing helpers and mocks
- [Socket API Reference](https://docs.socket.dev/reference) - Official API documentation
