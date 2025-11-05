# Testing Guide

Comprehensive guide for testing Socket SDK - includes setup, utilities, patterns, and best practices.

## Quick Start

| Task | Command |
|------|---------|
| **Run all tests** | `pnpm test` |
| **Run specific file** | `pnpm run test:run path/to/file.test.mts` |
| **Run with coverage** | `pnpm run cover` |
| **Coverage percentage** | `pnpm run coverage:percent` |

```typescript
import { describe, expect, it } from 'vitest'
import { setupTestClient } from './utils/environment.mts'
import nock from 'nock'

describe('SocketSdk - Feature Name', () => {
  const getClient = setupTestClient('test-api-token', { retries: 0 })

  it('should do something specific', async () => {
    // Arrange: Setup mock
    nock('https://api.socket.dev')
      .get('/v0/endpoint')
      .reply(200, { ok: true })

    // Act: Call method
    const result = await getClient().method()

    // Assert: Check result
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ok).toBe(true)
    }
  })
})
```

---

## Test Helpers

**Location:** `test/utils/environment.mts`

| Helper | Use Case | Auto Cleanup |
|--------|----------|--------------|
| **`setupTestClient()`** | Most tests - combines nock + client | ✓ |
| **`setupTestEnvironment()`** | Custom SDK instances needed | ✓ |
| **`createTestClient()`** | Unit tests, no HTTP mocking | ✗ |
| **`isCoverageMode`** | Detect coverage mode | N/A |

### `setupTestClient(token?, options?)` - RECOMMENDED

Combines nock setup and client creation with automatic cleanup.

```typescript
const getClient = setupTestClient('test-token', { retries: 0 })
// ✓ Automatic nock lifecycle
// ✓ Fresh client per test
// ✓ No cleanup boilerplate
```

**When to use:** 90% of SDK tests

### `setupTestEnvironment()`

Nock environment setup without client creation.

```typescript
setupTestEnvironment()
const client = new SocketSdk('custom-config')
```

**When to use:** Manual control over client creation needed

### `createTestClient(token?, options?)`

Client creation without automatic environment setup.

```typescript
const client = createTestClient('test-token', { retries: 0 })
```

**When to use:** Unit tests without HTTP mocking

### `isCoverageMode`

Boolean flag for coverage detection.

```typescript
import { isCoverageMode } from './utils/environment.mts'

if (isCoverageMode) {
  // Adjust test behavior
}
```

### Helper Selection Guide

```
What do you need?
│
├─ Fresh SDK instance per test with HTTP mocking?
│  └─ ✓ setupTestClient()
│
├─ Custom SDK configuration with HTTP mocking?
│  └─ ✓ setupTestEnvironment() + new SocketSdk()
│
├─ Unit test without HTTP mocking?
│  └─ ✓ createTestClient()
│
└─ Testing SDK initialization?
   └─ ✓ createTestClient() or new SocketSdk()
```

---

## Public Testing Utilities

Exported from `@socketsecurity/sdk/testing` for external use.

### Response Builders

```typescript
import {
  mockSuccessResponse,
  mockErrorResponse,
  mockApiErrorBody,
  mockSdkError
} from '@socketsecurity/sdk/testing'

// Success response
mockSuccessResponse({ id: '123' }, 200)
// → { success: true, status: 200, data: { id: '123' } }

// Error response
mockErrorResponse('Not found', 404)
// → { success: false, status: 404, error: 'Not found' }

// API error body (for nock)
mockApiErrorBody('Repository not found')
// → { error: { message: 'Repository not found' } }

// Common errors
mockSdkError('NOT_FOUND')      // status: 404
mockSdkError('UNAUTHORIZED')   // status: 401
mockSdkError('SERVER_ERROR')   // status: 500
```

### Fixtures

```typescript
import { fixtures } from '@socketsecurity/sdk/testing'

// Organizations
fixtures.organizations.basic  // { id, name, plan }
fixtures.organizations.full   // + timestamps

// Repositories
fixtures.repositories.basic   // { id, name, archived, default_branch }
fixtures.repositories.full    // + homepage, visibility, timestamps

// Scans
fixtures.scans.pending        // { id, status: 'pending' }
fixtures.scans.completed      // + completed_at
fixtures.scans.withIssues     // issues_found > 0

// Packages
fixtures.packages.safe        // { score: 95 }
fixtures.packages.vulnerable  // { score: 45 }
fixtures.packages.malware     // { score: 0 }
```

### Type Guards

```typescript
import { isSuccessResult, isErrorResult } from '@socketsecurity/sdk/testing'

if (isSuccessResult(result)) {
  console.log(result.data)  // Type-safe access
}

if (isErrorResult(result)) {
  console.log(result.error)  // Type-safe access
}
```

---

## Test Structure & Organization

### File Organization

```
test/
├── *.test.mts          # Test files
└── utils/              # Shared utilities
    ├── environment.mts # Test helpers
    └── README.md       # Utilities documentation
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| **Files** | `feature-name.test.mts` | `socket-sdk-quota.test.mts` |
| **Describes** | `'SocketSdk - Feature Name'` | `'SocketSdk - Quota Management'` |
| **Tests** | `'should do something specific'` | `'should fetch quota successfully'` |

❌ **Avoid:** `test1.test.mts`, `'tests'`, `'it works'`

---

## Usage Patterns

### Basic SDK Test

```typescript
import { setupTestClient } from './utils/environment.mts'
import nock from 'nock'

describe('SocketSdk - Quota', () => {
  const getClient = setupTestClient()

  it('should fetch quota successfully', async () => {
    nock('https://api.socket.dev')
      .get('/v0/quota')
      .reply(200, { quota: 1000 })

    const result = await getClient().getQuota()
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.quota).toBe(1000)
    }
  })

  it('should handle 401 errors', async () => {
    nock('https://api.socket.dev')
      .get('/v0/quota')
      .reply(401, { error: { message: 'Unauthorized' } })

    const result = await getClient().getQuota()
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.status).toBe(401)
    }
  })
})
```

### Custom SDK Configuration

```typescript
const getClient = setupTestClient('test-token', {
  baseUrl: 'https://custom.api.socket.dev',
  timeout: 10000,
  userAgent: 'Test/1.0'
})
```

### Multiple API Calls

```typescript
it('should handle multiple nock mocks', async () => {
  nock('https://api.socket.dev')
    .get('/v0/orgs/test-org/repos')
    .reply(200, { repos: [...] })
    .get('/v0/orgs/test-org/repos/repo1')
    .reply(200, { name: 'repo1' })

  const repoList = await getClient().getOrgRepoList('test-org')
  const repo1 = await getClient().getOrgRepo('test-org', 'repo1')

  expect(repoList.success).toBe(true)
  expect(repo1.success).toBe(true)
})
```

### Error Handling

```typescript
describe('Error Handling', () => {
  const getClient = setupTestClient()

  it('should handle 404 errors', async () => {
    nock('https://api.socket.dev')
      .get('/v0/nonexistent')
      .reply(404, { error: { message: 'Not found' } })

    const result = await getClient().getData()
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.status).toBe(404)
    }
  })

  it('should handle network errors', async () => {
    nock('https://api.socket.dev')
      .get('/v0/endpoint')
      .replyWithError('ECONNREFUSED')

    await expect(getClient().getData()).rejects.toThrow()
  })
})
```

### Unit Test with Fixtures

```typescript
import { mockSuccessResponse, fixtures } from '@socketsecurity/sdk/testing'

it('should fetch repository', async () => {
  const mockSdk = {
    getOrgRepo: vi.fn().mockResolvedValue(
      mockSuccessResponse(fixtures.repositories.full)
    )
  }

  const result = await mockSdk.getOrgRepo('org', 'repo')
  expect(result.success).toBe(true)
})
```

### Integration Test with Nock

```typescript
import nock from 'nock'
import { SocketSdk } from '@socketsecurity/sdk'
import { mockApiErrorBody } from '@socketsecurity/sdk/testing'

it('should handle API errors', async () => {
  nock('https://api.socket.dev')
    .get('/v0/repo/org/repo')
    .reply(404, mockApiErrorBody('Not found'))

  const client = new SocketSdk('test-token')
  const result = await client.getOrgRepo('org', 'repo')

  expect(result.success).toBe(false)
})
```

---

## Best Practices

### 1. Always Use Helper Functions

```typescript
✓ const getClient = setupTestClient()
✗ beforeEach(() => { nock.restore(); nock.activate() })
```

### 2. Type-Safe Result Checking

```typescript
✓ if (result.success) {
    expect(result.data.quota).toBe(1000)  // TypeScript knows data exists
  }

✗ expect(result.data.quota).toBe(1000)  // TypeScript error
```

### 3. Test Both Success and Error Paths

```typescript
describe('Complete Coverage', () => {
  it('should handle success', async () => { /* ... */ })
  it('should handle 401 error', async () => { /* ... */ })
  it('should handle network error', async () => { /* ... */ })
})
```

### 4. Use Fast Test Config

```typescript
✓ const getClient = setupTestClient('test-token', { retries: 0 })
✗ const getClient = setupTestClient('test-token', { retries: 3, retryDelay: 1000 })
```

### 5. Descriptive Naming

| Type | Good | Bad |
|------|------|-----|
| **File** | `socket-sdk-quota.test.mts` | `test1.test.mts` |
| **Describe** | `'SocketSdk - Quota Management'` | `'tests'` |
| **Test** | `'should fetch quota successfully'` | `'it works'` |

### 6. Specific Assertions

```typescript
✓ expect(result.data.quota).toBe(42)
✓ expect(result.data.items).toHaveLength(3)
✓ expect(result.data.name).toContain('value')

✗ expect(result.data).toBeTruthy()
✗ expect(result.data).toBeDefined()
```

### 7. Nock Mocking Pattern

```typescript
nock('https://api.socket.dev')
  .get('/v0/endpoint')
  .reply(200, { data: 'value' })

// Auto cleanup via setupTestClient()
```

---

## Coverage Mode Behavior

When running with `--coverage`:

| Behavior | Regular Mode | Coverage Mode |
|----------|--------------|---------------|
| **Nock validation** | Strict | Relaxed |
| **Pending mocks** | Throw errors | No errors |
| **Cleanup** | Standard | Aggressive (`abortPendingRequests`) |

### Skip Tests in Coverage Mode

```typescript
it.skipIf(isCoverageMode)('should test advanced feature', async () => {
  // This test only runs in regular mode
})
```

---

## Fast Test Configuration

`FAST_TEST_CONFIG` is automatically applied by test helpers:

```typescript
{
  retries: 0,         // No retries
  retryDelay: 0,      // No delay
  timeout: 5000       // 5 second timeout
}
```

---

## Key Benefits

- ✓ **Consistent nock lifecycle** - No forgotten cleanup
- ✓ **Fast test execution** - Optimized timeouts and retries
- ✓ **Type-safe results** - Full TypeScript support
- ✓ **Coverage mode handling** - Automatic adjustments
- ✓ **Reduced boilerplate** - 5-10 lines saved per test file
- ✓ **Rich fixtures** - Pre-built test data
- ✓ **Flexible mocking** - Response builders for any scenario

---

## See Also

- [CI Testing](./ci-testing.md) - Continuous integration setup
- [Scripts](./scripts.md) - Script organization patterns
- [API Reference](../api-reference.md) - Complete API documentation
- [Test Utils README](../../test/utils/README.md) - Detailed helper docs
