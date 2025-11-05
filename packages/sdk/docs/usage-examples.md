# Usage Examples

## Package Analysis

### Single Package

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key')

// Get score
const result = await client.getScoreByNpmPackage('express', '4.18.0')
if (result.success) {
  console.log(`Score: ${result.data.score}/100`)
}

// Get issues
const issues = await client.getIssuesByNpmPackage('express', '4.18.0')
if (issues.success) {
  issues.data.issues.forEach(i =>
    console.log(`[${i.severity}] ${i.type}: ${i.description}`)
  )
}
```

### Batch Analysis

```typescript
const result = await client.batchPackageFetch({
  components: [
    { purl: 'pkg:npm/express@4.18.0' },
    { purl: 'pkg:npm/react@18.0.0' }
  ]
})

if (result.success) {
  result.data.forEach(pkg =>
    console.log(`${pkg.name}@${pkg.version}: ${pkg.score}`)
  )
}
```

### Streaming

```typescript
const stream = client.batchPackageStream(
  { components: packages },
  { concurrency: 10 }
)

for await (const result of stream) {
  if (result.success && result.data.score < 70) {
    console.log(`⚠ ${result.data.name}: ${result.data.score}`)
  }
}
```

## Scanning

### Full Scan

```typescript
const scan = await client.createOrgFullScan(
  'my-org',
  ['package.json', 'package-lock.json'],
  process.cwd()
)

if (scan.success) {
  // Poll for completion
  while (true) {
    const status = await client.getOrgFullScanMetadata('my-org', scan.data.id)
    if (status.success && status.data.status === 'completed') break
    await new Promise(r => setTimeout(r, 5000))
  }

  const data = await client.getOrgFullScanBuffered('my-org', scan.data.id)
  if (data.success) {
    console.log(`Found ${data.data.packages.length} packages`)
  }
}
```

### Diff Scans

```typescript
const diffScan = await client.createOrgDiffScanFromIds('my-org', {
  from: 'scan_baseline',
  to: 'scan_current'
})

if (diffScan.success) {
  const diff = await client.getDiffScanById('my-org', diffScan.data.id)
  if (diff.success) {
    console.log(`Added: ${diff.data.added.length}`)
    console.log(`Removed: ${diff.data.removed.length}`)
    console.log(`Changed: ${diff.data.changed.length}`)
  }
}
```

## Organization

### Repositories

```typescript
const repos = await client.getOrgRepoList('my-org', { limit: 100 })

if (repos.success) {
  repos.data.repositories.forEach(repo =>
    console.log(`${repo.name}: ${repo.default_branch}`)
  )
}

// Create
const created = await client.createOrgRepo('my-org', {
  name: 'new-project',
  default_branch: 'main'
})

// Update
if (created.success) {
  await client.updateOrgRepo('my-org', 'new-project', {
    homepage: 'https://example.com'
  })
}
```

## Policy

### Security & License

```typescript
// Update security policy
await client.updateOrgSecurityPolicy('my-org', {
  securityPolicyRules: {
    malware: { action: 'error' },
    vulnerability: { action: 'warn' }
  }
})

// Update license policy
await client.updateOrgLicensePolicy('my-org', {
  allowed: ['MIT', 'Apache-2.0'],
  restricted: ['GPL-3.0']
})
```

## Analytics & Tokens

```typescript
// Analytics
const analytics = await client.getOrgAnalytics('30d')
if (analytics.success) {
  analytics.data.forEach(day =>
    console.log(`${day.date}: ${day.scans} scans`)
  )
}

// Tokens
const token = await client.postAPIToken('my-org', {
  name: 'CI/CD',
  scopes: ['read:scans', 'write:scans']
})

if (token.success) {
  await client.postAPITokensRotate('my-org', token.data.id)
}
```

## SBOM Export

```typescript
import { writeFile } from 'fs/promises'

// CycloneDX
const cdx = await client.exportCDX('my-org', 'scan_123')
if (cdx.success) {
  await writeFile('sbom.json', JSON.stringify(cdx.data, null, 2))
}

// SPDX
const spdx = await client.exportSPDX('my-org', 'scan_123')
if (spdx.success) {
  await writeFile('spdx.json', JSON.stringify(spdx.data, null, 2))
}
```

## Error Handling

```typescript
const result = await client.getScoreByNpmPackage('express', '4.18.0')

if (!result.success) {
  switch (result.status) {
    case 404: console.error('Not found'); break
    case 401: console.error('Invalid token'); break
    case 429: console.error('Rate limit'); break
    default: console.error(result.error)
  }
}
```

## Configuration

```typescript
// Production
const prod = new SocketSdk('key', {
  retries: 5,
  retryDelay: 2000,
  timeout: 60000
})

// Testing
const test = new SocketSdk('key', {
  retries: 0,
  timeout: 5000
})
```

## Streaming

```typescript
import { createWriteStream } from 'fs'

// Stream to file
await client.streamOrgFullScan(
  'my-org',
  'scan_large',
  createWriteStream('scan.json')
)

// Custom processing
const response = await client.getApi('/endpoint', {
  responseType: 'response'
})

if (response.success) {
  for await (const chunk of response.data) {
    // Process chunk
  }
}
```

## See Also

- [API Reference](./api-reference.md) - Complete API documentation
- [Quota Management](./quota-management.md) - Quota utilities
- [Testing Utilities](./dev/testing.md) - Testing helpers
