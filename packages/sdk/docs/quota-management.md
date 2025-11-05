# Quota Management

API methods have different costs: 0 (free), 10 (standard), or 100 (resource-intensive) units.

## Check Quota

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key')
const quota = await client.getQuota()

if (quota.success) {
  console.log(`Available: ${quota.data.quota} units`)
}
```

## Utilities

```typescript
import {
  getQuotaCost,
  calculateTotalQuotaCost,
  hasQuotaForMethods,
  getMethodsByQuotaCost,
  getRequiredPermissions,
  getQuotaUsageSummary
} from '@socketsecurity/sdk'

// Get cost for a method
getQuotaCost('batchPackageFetch')  // 100
getQuotaCost('createOrgFullScan')  // 10
getQuotaCost('getQuota')           // 0

// Calculate total cost
const cost = calculateTotalQuotaCost([
  'batchPackageFetch',  // 100
  'getOrgAnalytics',    // 10
  'getQuota'            // 0
])
// Returns: 110

// Check if enough quota
const canProceed = hasQuotaForMethods(availableQuota, [
  'batchPackageFetch',
  'createOrgFullScan'
])

// Get methods by cost
getMethodsByQuotaCost(0)    // ['getQuota', 'getOrganizations', ...]
getMethodsByQuotaCost(10)   // ['createOrgFullScan', 'getScan', ...]
getMethodsByQuotaCost(100)  // ['batchPackageFetch', ...]

// Get permissions required
getRequiredPermissions('createOrgFullScan')  // ['write:scans', 'read:repos']

// Get usage summary
const summary = getQuotaUsageSummary()
console.log(`Free: ${summary.free.length}`)
console.log(`Standard: ${summary.standard.length}`)
console.log(`Expensive: ${summary.expensive.length}`)
```

## Examples

### Pre-flight Check

```typescript
import { SocketSdk, calculateTotalQuotaCost, hasQuotaForMethods } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key')

const operations = ['batchPackageFetch', 'uploadManifestFiles']
const required = calculateTotalQuotaCost(operations)

const quota = await client.getQuota()
if (!quota.success || !hasQuotaForMethods(quota.data.quota, operations)) {
  throw new Error(`Need ${required} units, have ${quota.data.quota}`)
}

// Proceed with operations
```

### Optimize Usage

```typescript
import { SocketSdk, getMethodsByQuotaCost } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key')
const quota = await client.getQuota()

if (quota.success) {
  if (quota.data.quota < 100) {
    // Use free methods only
    const freeMethods = getMethodsByQuotaCost(0)
  } else if (quota.data.quota < 500) {
    // Use standard methods (10 units)
  } else {
    // Can use expensive operations (100 units)
  }
}
```

### Monitor Usage

```typescript
import { SocketSdk, getQuotaCost } from '@socketsecurity/sdk'

class QuotaTracker {
  private used = 0

  async track<T>(methodName: string, op: () => Promise<T>): Promise<T> {
    const cost = getQuotaCost(methodName)
    const result = await op()
    this.used += cost
    console.log(`Used ${this.used} units`)
    return result
  }
}

const tracker = new QuotaTracker()
await tracker.track('batchPackageFetch', () =>
  client.batchPackageFetch({ components })
)
```

### Fallback Strategy

```typescript
import { SocketSdk, getQuotaCost } from '@socketsecurity/sdk'

const client = new SocketSdk('your-api-key')

const quota = await client.getQuota()
const batchCost = getQuotaCost('batchPackageFetch')

if (quota.success && quota.data.quota >= batchCost) {
  // Use efficient batch method
  await client.batchPackageFetch({ components })
} else {
  // Fall back to individual queries
  for (const pkg of packages) {
    await client.getScoreByNpmPackage(pkg.name, pkg.version)
  }
}
```

## Cost Reference

**Free (0 units):** `getQuota`, `getOrganizations`, `getEnabledEntitlements`, `getEntitlements`

**Standard (10 units):** `createOrgFullScan`, `getScan`, `getScanList`, `getOrgAnalytics`, `getRepoAnalytics`, `getOrgSecurityPolicy`, `updateOrgSecurityPolicy`, `getOrgLicensePolicy`, `updateOrgLicensePolicy`, `getAuditLogEvents`

**Expensive (100 units):** `batchPackageFetch`, `batchPackageStream`, `uploadManifestFiles`, `createDependenciesSnapshot`

## Best Practices

- Check quota before expensive operations
- Use free methods for health checks
- Batch operations when possible (100 units for all packages vs 10 per package)
- Monitor quota usage with tracker
- Configure retries for transient failures

## See Also

- [API Reference](./api-reference.md) - Complete API documentation
- [Usage Examples](./usage-examples.md) - Usage patterns
- [Testing Utilities](./dev/testing.md) - Testing helpers
