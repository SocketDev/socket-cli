# Socket Infrastructure Improvements: HTTP & Error Handling

**Date:** 2025-10-04
**Status:** Partially Implemented
**Scope:** socket-registry, socket-sdk-js, socket-cli

## Executive Summary

This document describes infrastructure improvements made to the Socket ecosystem to enhance reliability through retry logic, download locking, and improved error handling. The work establishes foundation layer utilities in `socket-registry` that can be leveraged by `socket-sdk-js` and `socket-cli`.

## Completed Work

### socket-registry (✅ Committed: 2f3527a7)

#### 1. Enhanced HTTP Request Utilities (`registry/src/lib/http-request.ts`)

**Changes:**
- Rewrote from basic `http.get()` wrapper to full-featured HTTP client
- Added automatic retry logic with exponential backoff (1s, 2s, 4s, 8s...)
- Implemented redirect following (up to configurable `maxRedirects`, default: 5)
- Added file download support with streaming (avoids memory issues)
- Progress callbacks for monitoring downloads
- Fetch-like response API (`.text()`, `.json()`, `.arrayBuffer()`)

**New Functions:**
```typescript
// Core request with retry + redirects
httpRequest(url, options?: {
  retries?: number,           // default: 0
  retryDelay?: number,        // default: 1000ms
  followRedirects?: boolean,  // default: true
  maxRedirects?: number,      // default: 5
  timeout?: number,           // default: 30000ms
  method?: string,
  headers?: Record<string, string>,
  body?: Buffer | string
}): Promise<HttpResponse>

// File download with streaming + progress
httpDownload(url, destPath, options?: {
  retries?: number,
  timeout?: number,           // default: 120000ms
  onProgress?: (downloaded, total) => void
}): Promise<{ path: string, size: number }>

// Convenience helpers
httpGetJson<T>(url, options?): Promise<T>
httpGetText(url, options?): Promise<string>
```

**Example:**
```typescript
import { httpGetJson } from '@socketsecurity/registry/lib/http-request'

const data = await httpGetJson('https://api.github.com/repos/owner/repo', {
  retries: 3,  // Automatic exponential backoff!
  timeout: 30000,
})
```

#### 2. Download Locking (`registry/src/lib/download-lock.ts` - NEW)

**Purpose:** Prevent concurrent downloads of the same resource across processes

**Features:**
- File-based locking for cross-process synchronization
- Stale lock detection (removes locks from dead processes)
- Smart caching (returns immediately if file exists)
- Configurable timeouts: lock acquisition, stale detection, polling

**Function:**
```typescript
downloadWithLock(url, destPath, options?: {
  lockTimeout?: number,    // default: 60000ms (wait for other downloads)
  staleTimeout?: number,   // default: 300000ms (5 min before stale)
  pollInterval?: number,   // default: 1000ms
  locksDir?: string,       // default: '<destPath>/.locks'
  ...HttpDownloadOptions   // All download options supported
}): Promise<{ path: string, size: number }>
```

**Lock Mechanism:**
```
<destPath>/.locks/
└── <sanitized-filename>.lock  (JSON file)
    {
      "pid": 12345,
      "startTime": 1234567890,
      "url": "https://..."
    }
```

**Behavior:**
1. If file exists → return immediately (cached)
2. If lock exists and valid → wait for download (up to `lockTimeout`)
3. If lock is stale → remove and acquire
4. If lock acquired → download → release lock
5. If timeout → throw error

**Example:**
```typescript
import { downloadWithLock } from '@socketsecurity/registry/lib/download-lock'

// Multiple processes can call this - only one will download
const result = await downloadWithLock(
  'https://example.com/binary.tar.gz',
  '/tmp/cache/binary.tar.gz',
  {
    retries: 3,
    lockTimeout: 60000,  // Wait up to 1 minute
    onProgress: (d, t) => console.log(`${Math.floor(d/t*100)}%`)
  }
)
```

#### 3. Package Exports (`registry/package.json`)

Added public exports:
- `@socketsecurity/registry/lib/http-request`
- `@socketsecurity/registry/lib/download-lock`

#### 4. Documentation (`docs/HTTP_UTILITIES.md` - NEW)

Comprehensive 400+ line documentation including:
- API reference with TypeScript interfaces
- Usage examples for all functions
- Architecture explanations (retry logic, locking)
- Performance considerations
- Migration guide from `fetch()`
- Testing guidance

### Files Changed

**socket-registry:**
- ✅ `registry/src/lib/http-request.ts` (368 lines, enhanced)
- ✅ `registry/src/lib/download-lock.ts` (NEW, 214 lines)
- ✅ `registry/package.json` (added exports)
- ✅ `docs/HTTP_UTILITIES.md` (NEW, 400+ lines)

**Total:** 1 commit, 4 files, ~950 lines added/modified

## Remaining Work

### High Priority

#### 1. socket-sdk-js: Add Retry Configuration

**Current State:**
- SDK has `src/http-client.ts` with custom HTTP utilities
- Uses `createGetRequest()`, `createRequestWithJson()`, etc.
- No retry logic - fails on first error

**Proposed Changes:**
```typescript
// Option A: Wrap existing functions with retry
export async function createGetRequestWithRetry(
  baseUrl: string,
  urlPath: string,
  options: RequestOptions & { retries?: number },
): Promise<IncomingMessage> {
  const { retries = 0, ...requestOptions } = options

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await createGetRequest(baseUrl, urlPath, requestOptions)
    } catch (error) {
      if (attempt === retries) throw error
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
}

// Option B: Add retry to SocketSdk class config
class SocketSdk {
  constructor(token: string, options?: {
    baseUrl?: string,
    timeout?: number,
    retries?: number,      // NEW
    retryDelay?: number,   // NEW
  }) {
    this.retries = options?.retries ?? 3
    this.retryDelay = options?.retryDelay ?? 1000
  }
}
```

**Impact:**
- All SDK API calls get automatic retries
- Improves reliability for CLI and other SDK consumers
- Minimal changes to existing API

**Estimated Effort:** 2-3 hours
- Modify `http-client.ts` functions
- Update `socket-sdk-class.ts` constructor
- Add tests
- Update README

#### 2. socket-cli: Use Registry Download Lock

**Current State:**
- CLI has `src/utils/dlx-binary.mts` for binary downloads
- CLI has `src/utils/http.mts` with download support
- No cross-process locking - race conditions possible

**Proposed Changes:**
```typescript
// In src/utils/dlx-binary.mts
import { downloadWithLock } from '@socketsecurity/registry/lib/download-lock'

async function downloadBinary(url: string, binaryPath: string) {
  const result = await downloadWithLock(url, binaryPath, {
    retries: 3,
    lockTimeout: 60000,  // Wait for concurrent downloads
    onProgress: (downloaded, total) => {
      // Existing progress logging
    }
  })

  return result.path
}
```

**Impact:**
- Prevents redundant downloads when multiple processes run simultaneously
- Safer for CI/CD environments with parallel builds
- Reduces network bandwidth usage

**Estimated Effort:** 1-2 hours
- Replace download logic in `dlx-binary.mts`
- Replace download logic in `python-standalone.mts`
- Test with concurrent processes
- Update documentation

### Medium Priority

#### 3. Unit Tests

**socket-registry Tests Needed:**
```
test/registry/http-request.test.mts
- Test retry logic with failing responses
- Test redirect following
- Test download with progress
- Test timeout handling

test/registry/download-lock.test.mts
- Test lock acquisition
- Test stale lock cleanup
- Test concurrent download prevention
- Test process termination scenarios
```

**Estimated Effort:** 4-6 hours
- Write comprehensive test suites
- Mock Node http/https modules
- Test edge cases (timeouts, errors, race conditions)

#### 4. socket-sdk-js: Integrate Registry Cache

**Purpose:** Add response caching to reduce API calls

**Proposed Changes:**
```typescript
import { safeGet, put } from '@socketsecurity/registry/lib/cacache'

class SocketSdk {
  async getPackageScorecard(pkg: string) {
    const cacheKey = `socket:scorecard:${pkg}`
    const cached = await safeGet(cacheKey)

    if (cached && !this.isCacheExpired(cached)) {
      return JSON.parse(cached.data.toString())
    }

    const data = await this.api.getScorecard(pkg)
    await put(cacheKey, JSON.stringify(data), {
      metadata: { timestamp: Date.now() }
    })

    return data
  }
}
```

**Impact:**
- Faster responses for repeated queries
- Reduced API quota usage
- Better offline support

**Estimated Effort:** 3-4 hours
- Add cache layer to SDK
- Add cache configuration options
- Add cache invalidation methods

## Architecture Decisions

### Why socket-registry for HTTP Utilities?

**Rationale:**
1. **Infrastructure Layer**: HTTP and download utilities are fundamental infrastructure
2. **Shared Across Ecosystem**: CLI, SDK, and future tools all benefit
3. **Existing Cacache**: Registry already has caching utilities
4. **Dependency Direction**: Registry → SDK → CLI (clean layering)

**Alternative Considered:** Implementing in socket-cli directly
- ❌ Would require duplication in SDK
- ❌ Other Socket tools couldn't benefit
- ❌ Harder to test and maintain

### Why NOT Modify SDK Immediately?

**Rationale:**
1. **SDK has custom HTTP client**: Would require significant refactoring
2. **Backward compatibility concerns**: SDK is public API
3. **Foundation first**: Better to establish registry utilities first
4. **Incremental adoption**: SDK can adopt gradually

**Future Path:**
- SDK retries can be implemented using existing http-client.ts
- SDK can *optionally* use registry utilities for new features
- No breaking changes required

## Performance Considerations

### Memory

- Downloads use streaming via `pipe()` - no buffering in memory
- Response bodies buffered only for `httpRequest()` calls
- Lock files are small JSON (<1KB each)

### Network

- Exponential backoff prevents retry storms
- Download locks prevent redundant network usage
- Configurable timeouts prevent hanging

### Concurrency

- Locks are per-destination-path, not per-URL
- Multiple different downloads proceed in parallel
- Same-destination downloads serialized automatically

## Migration Guide

### For Socket CLI Developers

**Before (custom http.mts):**
```typescript
import { httpDownload } from './http.mts'

const result = await httpDownload(url, destPath, {
  onProgress: (d, t) => console.log(`${d}/${t}`)
})
```

**After (registry with locking):**
```typescript
import { downloadWithLock } from '@socketsecurity/registry/lib/download-lock'

const result = await downloadWithLock(url, destPath, {
  retries: 3,           // NEW: automatic retries
  lockTimeout: 60000,   // NEW: wait for other downloads
  onProgress: (d, t) => console.log(`${d}/${t}`)
})
```

### For Socket SDK Developers

**Current (no retries):**
```typescript
const sdk = new SocketSdk(token)
const data = await sdk.getPackageInfo('lodash')  // Fails on network error
```

**Future (with retries):**
```typescript
const sdk = new SocketSdk(token, {
  retries: 3,           // NEW: retry failed requests
  retryDelay: 1000,     // NEW: exponential backoff
})
const data = await sdk.getPackageInfo('lodash')  // Retries automatically
```

## Testing Strategy

### Unit Tests

**HTTP Request Tests:**
- Mock `node:http` and `node:https` modules
- Test successful requests
- Test retry logic (1st attempt fails, 2nd succeeds)
- Test timeout handling
- Test redirect following
- Test JSON parsing errors

**Download Lock Tests:**
- Test lock acquisition
- Test stale lock detection
- Test concurrent download prevention (spawn multiple processes)
- Test process crash scenarios

### Integration Tests

**CLI Tests:**
- Test binary download with concurrent processes
- Test cache reuse across invocations
- Test lock timeout scenarios

**SDK Tests:**
- Test retry logic with flaky API responses
- Test cache hit/miss scenarios
- Test timeout configuration

## Security Considerations

### Download Integrity

- Checksum verification still required at application level
- Lock files don't prevent malicious replacements
- Registry utilities don't handle checksums (app responsibility)

### Lock File Security

- Lock files use process PID for validation
- Stale locks from crashed processes auto-removed
- Lock directory should have appropriate permissions

### Retry Security

- Exponential backoff prevents retry storms
- Configurable max retries prevent infinite loops
- Timeouts prevent hanging indefinitely

## Metrics & Success Criteria

### Reliability

- **Target**: 99.9% success rate for API calls with retries
- **Measurement**: Track retry attempts and final outcomes

### Performance

- **Target**: < 5% overhead from retry logic
- **Target**: 50% reduction in redundant downloads (via locking)
- **Measurement**: Track download times and cache hits

### Adoption

- **Target**: socket-cli migrated to use download locks
- **Target**: socket-sdk-js using retry logic
- **Timeline**: 2-4 weeks for full adoption

## Future Enhancements

### Phase 2: Advanced Features

1. **Partial Download Resume**: Support `Range` headers for interrupted downloads
2. **Bandwidth Limiting**: Throttle download speed to reduce network impact
3. **Download Mirroring**: Try multiple URLs for the same resource
4. **Cache Warmup**: Proactively download frequently-used binaries

### Phase 3: Observability

1. **Metrics Collection**: Track retry rates, download times, cache hits
2. **Error Aggregation**: Centralize error reporting
3. **Performance Monitoring**: Track HTTP response times

## References

### Documentation

- **HTTP Utilities**: `socket-registry/docs/HTTP_UTILITIES.md`
- **Socket Registry**: `socket-registry/README.md`
- **Socket SDK**: `socket-sdk-js/README.md`
- **Socket CLI**: `socket-cli/README.md`

### Related Issues

- Yarn Berry ENOENT issue (Scale AI report) - improved by download locking
- API quota exhaustion - improved by retry logic with backoff
- Concurrent download race conditions - solved by download locking

### Commits

- **socket-registry**: `2f3527a7` - Add HTTP utilities with retry logic and download locking

## Appendix: Code Examples

### Example 1: Download with Retry and Locking

```typescript
import { downloadWithLock } from '@socketsecurity/registry/lib/download-lock'

async function downloadPythonRuntime() {
  const url = 'https://github.com/astral-sh/python-build-standalone/releases/download/...'
  const dest = '/tmp/python-3.10.18.tar.gz'

  try {
    const result = await downloadWithLock(url, dest, {
      retries: 3,           // Retry up to 3 times
      retryDelay: 1000,     // Start with 1s delay
      lockTimeout: 120000,  // Wait up to 2 min for other downloads
      timeout: 300000,      // 5 min total timeout per attempt
      onProgress: (downloaded, total) => {
        const pct = Math.floor((downloaded / total) * 100)
        if (pct % 10 === 0) {
          console.log(`Download: ${pct}% (${downloaded}/${total})`)
        }
      }
    })

    console.log(`Downloaded ${result.size} bytes to ${result.path}`)
  } catch (error) {
    console.error('Download failed after retries:', error.message)
  }
}
```

### Example 2: API Call with Retry (Future SDK)

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const sdk = new SocketSdk(process.env.SOCKET_TOKEN, {
  retries: 3,
  retryDelay: 1000,
  timeout: 30000,
})

async function getPackageScore(pkg: string) {
  try {
    // Automatically retries on network errors or 5xx responses
    const scorecard = await sdk.getPackageScorecard(pkg)
    console.log(`Score for ${pkg}: ${scorecard.score}`)
  } catch (error) {
    if (error.response?.status === 404) {
      console.error('Package not found')
    } else {
      console.error('Failed after retries:', error.message)
    }
  }
}
```

### Example 3: Cached API Response (Future SDK)

```typescript
import { SocketSdk } from '@socketsecurity/sdk'

const sdk = new SocketSdk(process.env.SOCKET_TOKEN, {
  cache: true,
  cacheTtl: 3600000,  // 1 hour
})

async function checkPackages(packages: string[]) {
  // First call: hits API, caches response
  const results1 = await Promise.all(
    packages.map(pkg => sdk.getPackageInfo(pkg))
  )

  // Second call (within 1 hour): uses cached responses
  const results2 = await Promise.all(
    packages.map(pkg => sdk.getPackageInfo(pkg))
  )

  // Invalidate cache for specific package
  await sdk.clearCache('lodash')

  // This call hits API again
  const fresh = await sdk.getPackageInfo('lodash')
}
```

---

**Document Version:** 1.0
**Last Updated:** 2025-10-04
**Authors:** Socket Infrastructure Team + Claude Code
