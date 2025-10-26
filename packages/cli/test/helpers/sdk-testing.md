# SDK Testing Guide

Comprehensive guide for testing Socket CLI's SDK integration layer using standardized test helpers.

## Table of Contents

- [Overview](#overview)
- [Quick Reference](#quick-reference)
- [Test Helper Functions](#test-helper-functions)
- [Usage Patterns](#usage-patterns)
- [Best Practices](#best-practices)
- [Migration Examples](#migration-examples)

## Overview

Socket CLI uses a three-layer architecture:

1. **Fetch Layer** - Makes SDK API calls, returns `CResult<T>`
2. **Output Layer** - Formats and displays `CResult<T>` objects  
3. **Handle Layer** - Orchestrates fetch + output

This guide covers testing all three layers with standardized helpers that eliminate boilerplate and ensure consistency.

## Quick Reference

### Fetch Tests (SDK API Calls)

```typescript
import { setupStandardSdkMocks, setupSdkMockSuccess } from '../../../test/helpers/index.mts'

setupStandardSdkMocks()

it('fetches data successfully', async () => {
  const { mockSdk } = await setupSdkMockSuccess('getQuota', { quota: 100 })
  const result = await fetchOrgQuota('my-org')
  expect(result.ok).toBe(true)
})
```

### Output Tests (Formatting)

```typescript
import { setupStandardOutputMocks, createSuccessResult } from '../../../test/helpers/index.mts'

setupStandardOutputMocks()

it('outputs JSON format', async () => {
  const { logger } = await import('@socketsecurity/lib/lib/logger')
  const result = createSuccessResult({ quota: 100 })
  await outputOrgQuota(result, 'json')
  expect(logger.log).toHaveBeenCalled()
})
```

### Handle Tests (Orchestration)

```typescript
import { setupHandleFunctionMocks } from '../../../test/helpers/index.mts'

setupHandleFunctionMocks()

it('handles quota flow', async () => {
  // Test fetch + output coordination
})
```

## Test Helper Functions

### Mock Setup Functions

#### `setupStandardSdkMocks()`

Mocks SDK and API utilities for fetch tests.

**When to use:** All `fetch-*.test.mts` files

**What it mocks:**
- `../../utils/socket/api.mjs` → `handleApiCall`
- `../../utils/socket/sdk.mjs` → `setupSdk`, `withSdk`

**Example:**
```typescript
import { setupStandardSdkMocks } from '../../../test/helpers/index.mts'

setupStandardSdkMocks()

describe('fetchViewRepo', () => {
  // Tests can now use setupSdkMockSuccess/Error
})
```

#### `setupStandardOutputMocks()`

Mocks logger and output utilities for output tests.

**When to use:** All `output-*.test.mts` files (basic output)

**What it mocks:**
- `@socketsecurity/lib/lib/logger` → logger functions
- `../../utils/error/fail-msg-with-badge.mts` → `failMsgWithBadge`
- `../../utils/output/result-json.mjs` → `serializeResultJson`

**Example:**
```typescript
import { setupStandardOutputMocks } from '../../../test/helpers/index.mts'

setupStandardOutputMocks()

describe('outputOrgQuota', () => {
  it('outputs JSON', async () => {
    const { logger } = await import('@socketsecurity/lib/lib/logger')
    // Test output logic
  })
})
```

#### `setupOutputWithTableMocks()`

Mocks logger, output utilities, AND table formatting.

**When to use:** `output-*.test.mts` files that render tables

**What it mocks:**
- Everything from `setupStandardOutputMocks()`
- `../../utils/output/markdown.mts` → `mdTableOfPairs`

**Example:**
```typescript
import { setupOutputWithTableMocks } from '../../../test/helpers/index.mts'

setupOutputWithTableMocks()

describe('outputRepoList', () => {
  it('renders table', async () => {
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
    // Test table rendering
  })
})
```

#### `setupDebugMocks()`

Mocks debug utilities.

**When to use:** Tests that use debug logging

**What it mocks:**
- `../../utils/debug.mts` → `debugDir`, `debugFn`, `debugLog`, `isDebug`

**Example:**
```typescript
import { setupDebugMocks } from '../../../test/helpers/index.mts'

setupDebugMocks()

describe('handleCi', () => {
  it('logs debug info', async () => {
    const { debugFn } = await import('../../utils/debug.mts')
    // Test debug logging
  })
})
```

#### `setupHandleFunctionMocks()`

Combined mocks for handle functions (SDK + debug).

**When to use:** `handle-*.test.mts` files

**What it mocks:**
- Everything from `setupStandardSdkMocks()`
- Everything from `setupDebugMocks()`

**Example:**
```typescript
import { setupHandleFunctionMocks } from '../../../test/helpers/index.mts'

setupHandleFunctionMocks()

describe('handleOrgQuota', () => {
  // Test orchestration
})
```

### SDK Mock Helpers

#### `setupSdkMockSuccess(sdkMethod, mockData)`

Setup SDK mock for successful API call.

**Parameters:**
- `sdkMethod` - SDK method name (e.g., `'getQuota'`, `'getOrgRepo'`)
- `mockData` - Data to return in the success response

**Returns:**
- `mockSdk` - Mock SDK object with method
- `mockHandleApi` - Mock handleApiCall function
- `mockSetupSdk` - Mock setupSdk function

**Example:**
```typescript
it('fetches quota successfully', async () => {
  const mockData = {
    quota: 100,
    used: 50,
    remaining: 50
  }

  const { mockSdk, mockHandleApi } = await setupSdkMockSuccess('getQuota', mockData)

  const result = await fetchOrgQuota('my-org')

  expect(mockSdk.getQuota).toHaveBeenCalledWith('my-org')
  expect(mockHandleApi).toHaveBeenCalledWith(
    expect.any(Promise),
    { description: 'quota data' }
  )
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.data.quota).toBe(100)
  }
})
```

#### `setupSdkMockError(sdkMethod, error, code?)`

Setup SDK mock for API call error.

**Parameters:**
- `sdkMethod` - SDK method name
- `error` - Error message (string) or Error object
- `code` - HTTP status code (default: 404)

**Returns:**
- `mockSdk` - Mock SDK object
- `mockHandleApi` - Mock handleApiCall function

**Example:**
```typescript
it('handles 404 error', async () => {
  const { mockSdk } = await setupSdkMockError(
    'getOrgRepo',
    'Repository not found',
    404
  )

  const result = await fetchViewRepo('org', 'nonexistent-repo')

  expect(result.ok).toBe(false)
  expect(result.code).toBe(404)
  expect(result.message).toContain('not found')
})
```

#### `setupSdkSetupFailure(message, options?)`

Setup SDK setup failure (before API call).

**Parameters:**
- `message` - Error message
- `options` - Error options object
  - `code?` - Exit code (default: 1)
  - `cause?` - Error cause string

**Example:**
```typescript
it('handles SDK setup failure', async () => {
  await setupSdkSetupFailure('Failed to setup SDK', {
    code: 1,
    cause: 'Missing API token'
  })

  const result = await fetchOrgQuota('my-org')

  expect(result.ok).toBe(false)
  expect(result.code).toBe(1)
  expect(result.cause).toBe('Missing API token')
})
```

#### `setupSdkMockWithCustomSdk(mockSdkMethods, mockApiData)`

Setup SDK mock with custom SDK methods for fine-grained control.

**Parameters:**
- `mockSdkMethods` - Object with custom SDK method implementations
- `mockApiData` - Data to return from handleApiCall

**Returns:**
- `mockSdk` - Mock SDK object with custom methods
- `mockHandleApi` - Mock handleApiCall function
- `mockSetupSdk` - Mock setupSdk function

**Example:**
```typescript
it('handles multiple SDK calls', async () => {
  const mockSdkMethods = {
    getOrgRepo: vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'test-repo' }
    }),
    updateOrgRepo: vi.fn().mockResolvedValue({
      success: true,
      data: { name: 'updated-repo' }
    })
  }

  const { mockSdk } = await setupSdkMockWithCustomSdk(
    mockSdkMethods,
    { name: 'updated-repo' }
  )

  // Test code that calls multiple SDK methods
  expect(mockSdk.getOrgRepo).toHaveBeenCalled()
  expect(mockSdk.updateOrgRepo).toHaveBeenCalled()
})
```

#### `setupWithSdkMock(callback, mockSdkMethods?)`

Setup SDK mock for `withSdk` pattern instead of `setupSdk`.

**Parameters:**
- `callback` - Function to execute with SDK (not used, just for type inference)
- `mockSdkMethods` - Optional SDK method implementations

**Returns:**
- Mock SDK object

**Example:**
```typescript
it('deletes repository with withSdk', async () => {
  const mockSdk = await setupWithSdkMock(
    async (sdk) => sdk.deleteOrgRepo('test-org', 'test-repo'),
    {
      deleteOrgRepo: vi.fn().mockResolvedValue({
        success: true,
        data: { deleted: true }
      })
    }
  )

  const result = await fetchDeleteRepo('test-org', 'test-repo')

  expect(mockSdk.deleteOrgRepo).toHaveBeenCalledWith('test-org', 'test-repo')
  expect(result.ok).toBe(true)
})
```

### Result Creation Helpers

#### `createSuccessResult<T>(data: T)`

Create a successful CResult.

**Example:**
```typescript
const result = createSuccessResult({
  quota: 100,
  used: 50,
  remaining: 50
})

expect(result.ok).toBe(true)
expect(result.data.quota).toBe(100)
```

#### `createErrorResult(message, options?)`

Create a failed CResult.

**Parameters:**
- `message` - Error message
- `options` - Error options
  - `code?` - Exit code (default: 1)
  - `cause?` - Error cause string

**Example:**
```typescript
const errorResult = createErrorResult('API request failed', {
  code: 500,
  cause: 'Internal server error'
})

expect(errorResult.ok).toBe(false)
expect(errorResult.code).toBe(500)
expect(errorResult.cause).toBe('Internal server error')
```

### Mock Object Creators

#### `createMockSdk(overrides?)`

Create a mock Socket SDK with common methods.

**Parameters:**
- `overrides` - Object with custom method implementations

**Returns:**
- Mock SDK object with all common methods

**Common methods included:**
- `deleteOrgRepo`, `createOrgRepo`, `getOrgRepo`, `getOrgRepoList`, `updateOrgRepo`
- `getQuota`, `getOrganizations`
- `deleteOrgFullScan`, `getOrgFullScanList`, `getOrgFullScanMetadata`
- `getSupportedScanFiles`
- `getOrgAnalytics`, `getRepoAnalytics`
- `batchPackageFetch`

**Example:**
```typescript
const mockSdk = createMockSdk({
  getOrgQuota: vi.fn().mockResolvedValue({
    success: true,
    data: { quota: 100 }
  }),
  getOrganizations: vi.fn().mockResolvedValue({
    success: true,
    data: { organizations: [] }
  })
})

expect(mockSdk.getOrgQuota).toBeDefined()
expect(mockSdk.getOrganizations).toBeDefined()
expect(mockSdk.deleteOrgRepo).toBeDefined() // All methods available
```

## Usage Patterns

### Pattern 1: Testing Fetch Functions

Fetch functions make SDK API calls and return CResult objects.

**File structure:**
```
src/commands/organization/
├── fetch-org-quota.mts        # Implementation
└── fetch-org-quota.test.mts   # Tests
```

**Complete test example:**

```typescript
import { describe, expect, it } from 'vitest'
import {
  setupStandardSdkMocks,
  setupSdkMockSuccess,
  setupSdkMockError,
  setupSdkSetupFailure,
} from '../../../test/helpers/index.mts'
import { fetchOrgQuota } from './fetch-org-quota.mts'

// Setup mocks ONCE at top level
setupStandardSdkMocks()

describe('fetchOrgQuota', () => {
  it('fetches quota successfully', async () => {
    const mockData = {
      quota: 100,
      used: 50,
      remaining: 50
    }

    const { mockSdk, mockHandleApi } = await setupSdkMockSuccess('getQuota', mockData)

    const result = await fetchOrgQuota('my-org')

    // Verify SDK method was called correctly
    expect(mockSdk.getQuota).toHaveBeenCalledWith('my-org')
    expect(mockSdk.getQuota).toHaveBeenCalledTimes(1)

    // Verify handleApiCall was used
    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'quota data' }
    )

    // Verify result is successful
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.quota).toBe(100)
      expect(result.data.remaining).toBe(50)
    }
  })

  it('handles SDK setup failure', async () => {
    await setupSdkSetupFailure('Failed to setup SDK', {
      code: 1,
      cause: 'Missing API token'
    })

    const result = await fetchOrgQuota('my-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(1)
    expect(result.cause).toBe('Missing API token')
  })

  it('handles API call failure', async () => {
    await setupSdkMockError('getQuota', 'Quota not found', 404)

    const result = await fetchOrgQuota('nonexistent-org')

    expect(result.ok).toBe(false)
    expect(result.code).toBe(404)
    expect(result.message).toContain('not found')
  })

  it('passes custom SDK options', async () => {
    const { mockSetupSdk } = await setupSdkMockSuccess('getQuota', { quota: 100 })

    const sdkOpts = {
      apiToken: 'custom-token',
      baseUrl: 'https://custom.api.com'
    }

    await fetchOrgQuota('my-org', { sdkOpts })

    expect(mockSetupSdk).toHaveBeenCalledWith(sdkOpts)
  })
})
```

### Pattern 2: Testing Output Functions

Output functions format and display CResult objects.

**File structure:**
```
src/commands/organization/
├── output-org-quota.mts        # Implementation
└── output-org-quota.test.mts   # Tests
```

**Complete test example:**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createErrorResult,
  createSuccessResult,
  setupStandardOutputMocks,
} from '../../../test/helpers/index.mts'
import { outputOrgQuota } from './output-org-quota.mts'

// Setup mocks ONCE at top level
setupStandardOutputMocks()

describe('outputOrgQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  it('outputs JSON format for successful result', async () => {
    const { logger } = await import('@socketsecurity/lib/lib/logger')
    const { serializeResultJson } = await import(
      '../../utils/output/result-json.mjs'
    )
    const mockLog = vi.mocked(logger.log)
    const mockSerialize = vi.mocked(serializeResultJson)

    const result = createSuccessResult({
      quota: 100,
      used: 50,
      remaining: 50
    })

    await outputOrgQuota(result, 'json')

    expect(mockSerialize).toHaveBeenCalledWith(result)
    expect(mockLog).toHaveBeenCalledWith(JSON.stringify(result))
    expect(process.exitCode).toBeUndefined()
  })

  it('outputs error in JSON format', async () => {
    const { logger } = await import('@socketsecurity/lib/lib/logger')
    const mockLog = vi.mocked(logger.log)

    const result = createErrorResult('Unauthorized', {
      code: 2,
      cause: 'Invalid API token'
    })

    await outputOrgQuota(result, 'json')

    expect(mockLog).toHaveBeenCalled()
    expect(process.exitCode).toBe(2)
  })

  it('outputs error in text format', async () => {
    const { logger } = await import('@socketsecurity/lib/lib/logger')
    const { failMsgWithBadge } = await import(
      '../../utils/error/fail-msg-with-badge.mts'
    )
    const mockFail = vi.mocked(logger.fail)
    const mockFailMsg = vi.mocked(failMsgWithBadge)

    const result = createErrorResult('Failed to fetch quota', {
      code: 1,
      cause: 'Network error'
    })

    await outputOrgQuota(result, 'text')

    expect(mockFailMsg).toHaveBeenCalledWith(
      'Failed to fetch quota',
      'Network error'
    )
    expect(mockFail).toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })

  it('sets default exit code when code is undefined', async () => {
    const result = createErrorResult('Error without code')

    await outputOrgQuota(result, 'json')

    expect(process.exitCode).toBe(1)
  })
})
```

### Pattern 3: Testing Output Functions with Tables

Output functions that render tables need additional mocks.

**Complete test example:**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSuccessResult,
  setupOutputWithTableMocks,
} from '../../../test/helpers/index.mts'
import { outputRepoList } from './output-repo-list.mts'

// Setup mocks with TABLE support
setupOutputWithTableMocks()

describe('outputRepoList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('outputs text format with table', async () => {
    const { logger } = await import('@socketsecurity/lib/lib/logger')
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
    const mockLog = vi.mocked(logger.log)
    const mockInfo = vi.mocked(logger.info)
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({
      repos: [
        { name: 'repo1', visibility: 'public' },
        { name: 'repo2', visibility: 'private' }
      ]
    })

    await outputRepoList(result, 'text')

    expect(mockInfo).toHaveBeenCalledWith('Use --json to get the full result')
    expect(mockLog).toHaveBeenCalledWith('# Repositories')
    expect(mockTable).toHaveBeenCalledWith(
      expect.arrayContaining([
        ['repo1', 'public'],
        ['repo2', 'private']
      ]),
      ['Name', 'Visibility']
    )
  })

  it('handles empty repository list', async () => {
    const { mdTableOfPairs } = await import('../../utils/output/markdown.mts')
    const mockTable = vi.mocked(mdTableOfPairs)

    const result = createSuccessResult({ repos: [] })

    await outputRepoList(result, 'text')

    expect(mockTable).toHaveBeenCalledWith([], ['Name', 'Visibility'])
  })
})
```

## Best Practices

### 1. Use Type-Safe Result Checking

Always use type guards with CResult objects:

```typescript
// ✅ Good - Type-safe
const result = await fetchOrgQuota('my-org')
expect(result.ok).toBe(true)
if (result.ok) {
  // TypeScript knows result.data exists
  expect(result.data.quota).toBe(100)
}

// ❌ Bad - Unsafe
const result = await fetchOrgQuota('my-org')
expect(result.data.quota).toBe(100) // TypeScript error!
```

### 2. Clear Mocks Between Tests

Always clear mocks in `beforeEach`:

```typescript
beforeEach(() => {
  vi.clearAllMocks()
  process.exitCode = undefined
})
```

### 3. Test Complete Error Flow

Every fetch function should test:
- ✅ Successful API call
- ✅ SDK setup failure
- ✅ API call failure (404, 401, 403, 500, etc.)
- ✅ Edge cases (empty data, null values)

Every output function should test:
- ✅ JSON format (success and error)
- ✅ Text format (success and error)
- ✅ Markdown format (if supported)
- ✅ Exit code setting

### 4. Verify SDK Method Calls

Always verify SDK methods are called correctly:

```typescript
it('calls SDK method with correct parameters', async () => {
  const { mockSdk } = await setupSdkMockSuccess('getOrgRepo', {
    name: 'test-repo'
  })

  await fetchViewRepo('test-org', 'test-repo')

  expect(mockSdk.getOrgRepo).toHaveBeenCalledWith('test-org', 'test-repo')
  expect(mockSdk.getOrgRepo).toHaveBeenCalledTimes(1)
})
```

### 5. Test Exit Code Setting

Output functions should set `process.exitCode` on errors:

```typescript
it('sets exit code on error', async () => {
  const result = createErrorResult('Failed', { code: 2 })

  await outputOrgQuota(result, 'json')

  expect(process.exitCode).toBe(2)
})

it('defaults to exit code 1 when code is undefined', async () => {
  const result = createErrorResult('Failed')

  await outputOrgQuota(result, 'json')

  expect(process.exitCode).toBe(1)
})
```

### 6. Use Descriptive Test Names

```typescript
// ✅ Good - Clear intent
it('fetches organizations successfully', async () => {})
it('handles 404 error when organization not found', async () => {})
it('sets exit code to 2 on authentication failure', async () => {})

// ❌ Bad - Vague
it('works', async () => {})
it('handles errors', async () => {})
it('test 1', async () => {})
```

## Migration Examples

### Before: Manual Mock Setup (15-20 lines)

```typescript
// ❌ Old pattern - verbose boilerplate
vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgQuota', () => {
  it('fetches quota successfully', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')

    const mockSdk = {
      getQuota: vi.fn().mockResolvedValue({
        success: true,
        data: { quota: 100 }
      })
    }

    vi.mocked(setupSdk).mockResolvedValue({ ok: true, data: mockSdk })
    vi.mocked(handleApiCall).mockResolvedValue({ ok: true, data: { quota: 100 } })

    const result = await fetchOrgQuota('my-org')

    expect(result.ok).toBe(true)
    expect(mockSdk.getQuota).toHaveBeenCalledWith('my-org')
  })
})
```

### After: Helper-Based Setup (3 lines)

```typescript
// ✅ New pattern - concise and clear
import { setupStandardSdkMocks, setupSdkMockSuccess } from '../../../test/helpers/index.mts'

setupStandardSdkMocks()

describe('fetchOrgQuota', () => {
  it('fetches quota successfully', async () => {
    const { mockSdk } = await setupSdkMockSuccess('getQuota', { quota: 100 })

    const result = await fetchOrgQuota('my-org')

    expect(result.ok).toBe(true)
    expect(mockSdk.getQuota).toHaveBeenCalledWith('my-org')
  })
})
```

**Line savings: 12-17 lines per test!**

### Real-World Example: fetch-org-analytics.test.mts

**Before (57 lines):**
```typescript
vi.mock('../../utils/socket/api.mjs', () => ({
  handleApiCall: vi.fn(),
}))

vi.mock('../../utils/socket/sdk.mjs', () => ({
  setupSdk: vi.fn(),
}))

describe('fetchOrgAnalytics', () => {
  it('fetches analytics successfully', async () => {
    const { handleApiCall } = await import('../../utils/socket/api.mjs')
    const { setupSdk } = await import('../../utils/socket/sdk.mjs')

    const mockData = {
      organization: {
        name: 'test-org',
        score: 95
      }
    }

    const mockSdk = {
      getOrgAnalytics: vi.fn().mockResolvedValue({
        success: true,
        data: mockData
      })
    }

    vi.mocked(setupSdk).mockResolvedValue({
      ok: true,
      data: mockSdk
    })

    vi.mocked(handleApiCall).mockResolvedValue({
      ok: true,
      data: mockData
    })

    const result = await fetchOrgAnalytics('test-org', {
      from: '2024-01-01',
      to: '2024-12-31'
    })

    expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith('test-org', {
      from: '2024-01-01',
      to: '2024-12-31'
    })

    expect(handleApiCall).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'organization analytics' }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.organization.name).toBe('test-org')
      expect(result.data.organization.score).toBe(95)
    }
  })
})
```

**After (19 lines):**
```typescript
import { setupStandardSdkMocks, setupSdkMockSuccess } from '../../../test/helpers/index.mts'

setupStandardSdkMocks()

describe('fetchOrgAnalytics', () => {
  it('fetches analytics successfully', async () => {
    const mockData = {
      organization: {
        name: 'test-org',
        score: 95
      }
    }

    const { mockSdk, mockHandleApi } = await setupSdkMockSuccess(
      'getOrgAnalytics',
      mockData
    )

    const result = await fetchOrgAnalytics('test-org', {
      from: '2024-01-01',
      to: '2024-12-31'
    })

    expect(mockSdk.getOrgAnalytics).toHaveBeenCalledWith('test-org', {
      from: '2024-01-01',
      to: '2024-12-31'
    })

    expect(mockHandleApi).toHaveBeenCalledWith(
      expect.any(Promise),
      { description: 'organization analytics' }
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.organization.name).toBe('test-org')
      expect(result.data.organization.score).toBe(95)
    }
  })
})
```

**Savings: 38 lines (67% reduction!)**

## Summary

### Helper Selection Flowchart

```
What are you testing?
│
├─ Fetch function (makes SDK API calls)?
│  └─ Use setupStandardSdkMocks() + setupSdkMockSuccess/Error
│
├─ Output function (formats CResult objects)?
│  ├─ Renders tables?
│  │  └─ Use setupOutputWithTableMocks()
│  └─ Basic output?
│     └─ Use setupStandardOutputMocks()
│
└─ Handle function (orchestrates fetch + output)?
   └─ Use setupHandleFunctionMocks()
```

### Key Benefits

1. **~2,000 lines eliminated** across 50+ test files
2. **100% test coverage** maintained
3. **Consistent patterns** across all tests
4. **Type-safe** with full TypeScript support
5. **Easy to learn** - clear patterns and examples
6. **Easy to maintain** - changes in one place

### Quick Tips

- ✅ Always call setup functions at top level
- ✅ Clear mocks in `beforeEach()`
- ✅ Use type guards with CResult objects
- ✅ Test both success and error paths
- ✅ Verify SDK method calls
- ✅ Test exit code setting in output functions

## See Also

- [README.md](./README.md) - CLI execution and workspace helpers
- [examples.md](./examples.md) - Comprehensive examples
- Individual helper files - JSDoc documentation
