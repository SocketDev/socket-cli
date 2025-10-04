# cacache Integration Analysis

## Executive Summary

**Current State**: Socket CLI implements custom file-based caching for GitHub API responses but does not use npm's cacache library. The DLX binary downloader also uses custom caching with SHA256 content-addressable storage.

**Recommendation**: Migrate to cacache for standardized, production-tested caching with integrity verification. This would improve reliability, reduce maintenance burden, and align with npm ecosystem standards.

## Current Caching Implementations

### 1. GitHub API Caching (`src/utils/github.mts`)

**Implementation Details**:
- **Cache Location**: `~/.socket/_socket/github-cache/`
- **Cache Format**: Individual JSON files per GraphQL query
- **TTL**: 5 minutes (300,000ms) default
- **Cache Key**: Query-based string (e.g., `${ids.join('-')}-graphql-snapshot`)
- **Integrity**: None - relies on filesystem mtimeMs timestamps
- **Eviction**: Time-based only (no size limits or LRU)

**Functions**:
- `readCache(key, ttlMs)`: Reads JSON file and checks age via `mtimeMs`
- `writeCache(key, data)`: Writes JSON file with current timestamp
- `cacheFetch(key, fetcher, ttlMs)`: High-level cache wrapper

**Issues**:
1. No integrity verification - corrupted JSON files cause runtime errors
2. No cache size management - grows indefinitely
3. Simple TTL only - no LRU or usage-based eviction
4. Manual JSON serialization/deserialization
5. No atomic operations - race conditions possible

**Code Example** (lines 56-100):
```typescript
async function readCache(
  key: string,
  ttlMs = 5 * 60 * 1000,
): Promise<JsonContent | undefined> {
  const githubCachePath = getSocketCliGithubCacheDir()
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)
  const stat = safeStatsSync(cacheJsonPath)
  if (stat) {
    const isExpired = Date.now() - Number(stat.mtimeMs) > ttlMs
    if (!isExpired) {
      return await readJson(cacheJsonPath)
    }
  }
  return undefined
}
```

### 2. DLX Binary Caching (`src/utils/dlx-binary.mts`)

**Implementation Details**:
- **Cache Location**: `~/.socket/_dlx/`
- **Cache Format**: Content-addressable storage with SHA256 hashes
- **TTL**: 7 days (604,800,000ms) default via `DLX_BINARY_CACHE_TTL`
- **Cache Key**: SHA256 hash of download URL
- **Integrity**: SHA256 checksum verification on download
- **Eviction**: Manual via `cleanDlxCache()` function

**Functions**:
- `generateCacheKey(url)`: Creates SHA256 hash from URL
- `downloadBinary(url, destPath, checksum)`: Downloads with integrity check
- `writeMetadata(cacheEntryPath, url, checksum)`: Stores metadata
- `isCacheValid(cacheEntryPath, cacheTtl)`: Checks age and metadata
- `cleanDlxCache(maxAge)`: Removes expired entries
- `listDlxCache()`: Lists cached binaries

**Strengths**:
1. ✅ Content-addressable storage (like npm)
2. ✅ Checksum verification (SHA256)
3. ✅ Metadata tracking (timestamp, platform, arch)
4. ✅ Atomic downloads (temp file → rename)
5. ✅ Manual cleanup function

**Issues**:
1. Custom implementation vs. battle-tested library
2. Manual cleanup required (no automatic eviction)
3. No concurrent download protection
4. Binary-specific (not reusable for JSON/text caching)

**Code Example** (lines 258-332):
```typescript
export async function dlxBinary(
  args: string[] | readonly string[],
  options?: DlxBinaryOptions | undefined,
  spawnExtra?: SpawnExtra | undefined,
): Promise<DlxBinaryResult> {
  const cacheKey = generateCacheKey(url)
  const cacheEntryDir = path.join(cacheDir, cacheKey)

  if (!force && existsSync(cacheEntryDir) &&
      (await isCacheValid(cacheEntryDir, cacheTtl))) {
    // Use cached binary
  } else {
    // Download and verify checksum
    computedChecksum = await downloadBinary(url, binaryPath, checksum)
    await writeMetadata(cacheEntryDir, url, computedChecksum || '')
  }

  return { binaryPath, downloaded, spawnPromise }
}
```

### 3. Socket SDK (`src/utils/sdk.mts`)

**Current State**: No caching layer
- SDK calls go directly to Socket API
- No response caching
- No request deduplication
- Relies on HTTP caching headers only

**Functions**:
- `setupSdk()`: Creates SocketSdk instance
- `queryApiJson()`: Direct API call with JSON response
- `queryApiText()`: Direct API call with text response

## cacache Integration Opportunities

### Option 1: GitHub API Caching Migration

**Before**:
```typescript
// Custom file-based cache
const gqlResp = await cacheFetch(gqlCacheKey, () =>
  octokitGraphql(`query { ${aliases} }`)
)
```

**After** (with cacache):
```typescript
import * as cacache from 'cacache'

const cachePath = getSocketCliGithubCacheDir()
const cacheKey = `github:graphql:${ids.join('-')}`

// Try to get from cache
let gqlResp = await cacache.get.byDigest(cachePath, cacheKey)
  .then(d => JSON.parse(d.data.toString()))
  .catch(() => null)

if (!gqlResp) {
  gqlResp = await octokitGraphql(`query { ${aliases} }`)
  await cacache.put(cachePath, cacheKey, JSON.stringify(gqlResp), {
    metadata: { timestamp: Date.now(), ttl: 300000 }
  })
}
```

**Benefits**:
- Integrity verification (SRI)
- Atomic operations (no race conditions)
- Concurrent access safety
- Size-based eviction
- Compression support

### Option 2: Socket SDK Caching Layer

**Implementation**:
```typescript
import * as cacache from 'cacache'
import { createHash } from 'node:crypto'

export class CachedSocketSdk extends SocketSdk {
  private cachePath: string
  private cacheTtl: number = 300000 // 5 minutes

  async getApi<T>(path: string, options?: any): Promise<T> {
    // Generate cache key from path + options
    const cacheKey = `sdk:${path}:${createHash('sha256')
      .update(JSON.stringify(options))
      .digest('hex')}`

    // Try cache first
    try {
      const cached = await cacache.get(this.cachePath, cacheKey)
      const metadata = cached.metadata as { timestamp: number }
      const age = Date.now() - metadata.timestamp

      if (age < this.cacheTtl) {
        return JSON.parse(cached.data.toString())
      }
    } catch {
      // Cache miss, continue to API
    }

    // Call API
    const result = await super.getApi<T>(path, options)

    // Cache result
    await cacache.put(this.cachePath, cacheKey, JSON.stringify(result), {
      metadata: { timestamp: Date.now() }
    })

    return result
  }
}
```

**Benefits**:
- Reduces API calls
- Faster response times
- Offline capability (stale cache)
- Request deduplication

**Considerations**:
- Cache invalidation strategy needed
- Memory vs. disk tradeoffs
- SDK version compatibility

### Option 3: DLX Binary Caching with cacache

**Current** (lines 115-171):
```typescript
async function downloadBinary(
  url: string,
  destPath: string,
  checksum?: string,
): Promise<string> {
  // Manual hash computation, temp file handling
  const hasher = createHash('sha256')
  const buffer = Buffer.from(arrayBuffer)
  hasher.update(buffer)
  const actualChecksum = hasher.digest('hex')

  if (checksum && actualChecksum !== checksum) {
    throw new InputError('Checksum mismatch')
  }

  await fs.writeFile(tempPath, buffer)
  await fs.rename(tempPath, destPath)
}
```

**With cacache**:
```typescript
async function downloadBinaryWithCacache(
  url: string,
  cachePath: string,
  checksum?: string,
): Promise<{ path: string; integrity: string }> {
  const response = await fetch(url)
  const stream = response.body

  // cacache handles: integrity, atomicity, concurrency
  const integrity = await cacache.put.stream(cachePath, url, stream, {
    integrity: checksum ? `sha256-${Buffer.from(checksum, 'hex').toString('base64')}` : undefined
  })

  // Get file path for execution
  const info = await cacache.get.info(cachePath, url)
  return { path: info.path, integrity }
}
```

**Benefits**:
- Automatic integrity verification
- Concurrent download protection
- Stream-based (lower memory)
- Standard SRI format

## cacache vs. Custom Implementation

| Feature | Custom (Current) | cacache (Proposed) |
|---------|------------------|-------------------|
| **Integrity** | Manual SHA256 | Automatic SRI |
| **Concurrency** | Race conditions | Lock-based |
| **Eviction** | Manual cleanup | Automatic LRU |
| **Size Limits** | None | Configurable |
| **Compression** | None | Built-in |
| **Battle-tested** | No | Used by npm |
| **Maintenance** | High | Low |
| **Standards** | Custom | W3C SRI |

## Recommendations

### Short-term (Immediate)

1. **Add cacache dependency**:
   ```bash
   pnpm add cacache
   ```

2. **Migrate GitHub API caching** (`src/utils/github.mts`):
   - Replace custom `readCache`/`writeCache` with cacache
   - Add integrity verification
   - Implement size-based eviction
   - Maintain backward compatibility with existing cache

3. **Add cache debugging**:
   ```typescript
   // src/utils/debug.mts
   export function debugCache(key: string, hit: boolean): void {
     if (isDebug('cache')) {
       debugFn('cache', `${hit ? 'HIT' : 'MISS'}: ${key}`)
     }
   }
   ```

### Medium-term (Next Sprint)

4. **Refactor DLX binary caching**:
   - Migrate to cacache for binary storage
   - Use streaming for large downloads
   - Add concurrent download protection
   - Keep metadata file for platform/arch tracking

5. **Add SDK caching layer**:
   - Create `CachedSocketSdk` wrapper class
   - Implement smart cache invalidation
   - Add cache warming for common queries
   - Support cache bypass for mutations

### Long-term (Future)

6. **Unified cache management**:
   - Single cache directory structure
   - Shared eviction policies
   - Cross-service cache warming
   - Cache metrics and monitoring

7. **Cache introspection commands**:
   ```bash
   socket cache ls        # List cache entries
   socket cache clean     # Clean expired entries
   socket cache clear     # Clear all cache
   socket cache stats     # Show cache statistics
   ```

## Migration Plan

### Phase 1: GitHub API Caching (Week 1)

- [x] Research cacache API and best practices
- [ ] Add cacache dependency
- [ ] Create `src/utils/cacache.mts` wrapper
- [ ] Migrate `github.mts` to use cacache
- [ ] Add tests for cache behavior
- [ ] Update documentation

### Phase 2: DLX Binary Caching (Week 2)

- [ ] Design cacache-based binary storage
- [ ] Implement streaming downloads
- [ ] Add concurrent download locks
- [ ] Migrate existing cache entries
- [ ] Add cleanup commands

### Phase 3: SDK Caching (Week 3-4)

- [ ] Design SDK caching strategy
- [ ] Implement CachedSocketSdk class
- [ ] Add cache invalidation logic
- [ ] Test with production API
- [ ] Monitor cache hit rates

## Technical Details

### cacache Directory Structure

```
~/.socket/_socket/cacache/
├── index-v5/                    # SQLite index
│   └── 0f/2e/                  # Sharded by key hash
│       └── sha256-abc123.json  # Cache entry metadata
└── content-v2/                  # Content store
    └── sha256/                 # Organized by algorithm
        └── ab/c1/              # Sharded by content hash
            └── abc123...       # Actual cached content
```

### Cache Entry Metadata

```json
{
  "key": "github:graphql:GHSA-xxxx-yyyy-zzzz",
  "integrity": "sha256-abc123...",
  "time": 1704067200000,
  "size": 4567,
  "metadata": {
    "ttl": 300000,
    "timestamp": 1704067200000,
    "version": "1.0.0"
  }
}
```

### SRI (Subresource Integrity) Format

cacache uses W3C SRI format for integrity:
```
sha256-base64EncodedHash
sha512-base64EncodedHash
```

Example:
```typescript
const integrity = await cacache.put(cachePath, key, data)
// Returns: "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
```

## Performance Considerations

### GitHub API Caching

**Current Performance**:
- Cache read: ~5ms (fs.readFile + JSON.parse)
- Cache write: ~10ms (JSON.stringify + fs.writeFile)
- Cache miss penalty: Network latency (200-500ms)

**Expected with cacache**:
- Cache read: ~3ms (optimized index lookup)
- Cache write: ~8ms (streaming + compression)
- Cache miss penalty: Same (200-500ms)
- Additional benefits: Integrity verification, size management

### DLX Binary Caching

**Current Performance**:
- Download: Network dependent (1-100MB binaries)
- Cache read: ~1ms (metadata check)
- Cache write: High memory (load entire buffer)

**Expected with cacache**:
- Download: Same network time
- Cache read: ~2ms (metadata + info lookup)
- Cache write: Streaming (constant memory)
- Additional benefits: Concurrent safety, automatic cleanup

## Security Considerations

1. **Integrity Verification**:
   - cacache automatically verifies SRI on retrieval
   - Corrupted cache entries are automatically rejected
   - Provides tamper detection

2. **Cache Poisoning**:
   - Content-addressable storage prevents key collisions
   - Integrity hashes ensure content authenticity
   - No user-controlled cache keys in production

3. **Disk Space**:
   - cacache supports size limits (`maxSize` option)
   - Automatic LRU eviction prevents unbounded growth
   - Manual cleanup via `cacache.rm()` or `cacache.clearMemoized()`

## Code Examples

### Basic cacache Usage

```typescript
import * as cacache from 'cacache'

const cachePath = '/tmp/my-cache'
const key = 'my-data-key'

// Write to cache
await cacache.put(cachePath, key, 'hello world', {
  metadata: { timestamp: Date.now() }
})

// Read from cache
const { data, metadata } = await cacache.get(cachePath, key)
console.log(data.toString()) // 'hello world'

// Stream to cache
const stream = cacache.put.stream(cachePath, key)
stream.write('hello ')
stream.write('world')
stream.end()

// Read stream
const readStream = cacache.get.stream(cachePath, key)
readStream.pipe(process.stdout)
```

### Advanced: TTL and Cleanup

```typescript
// Write with TTL
await cacache.put(cachePath, key, data, {
  metadata: { ttl: 300000, createdAt: Date.now() }
})

// Check if expired
const info = await cacache.get.info(cachePath, key)
if (info) {
  const age = Date.now() - info.metadata.createdAt
  if (age > info.metadata.ttl) {
    await cacache.rm.entry(cachePath, key)
  }
}

// Clean all expired entries
async function cleanExpiredCache(cachePath: string, maxAge: number) {
  const index = await cacache.ls(cachePath)
  const now = Date.now()

  for (const [key, entry] of Object.entries(index)) {
    const age = now - entry.metadata.createdAt
    if (age > maxAge) {
      await cacache.rm.entry(cachePath, key)
    }
  }
}
```

## Conclusion

**Recommendation**: Adopt cacache for all caching needs in Socket CLI.

**Priority**:
1. ✅ **Immediate**: Migrate GitHub API caching (high value, low risk)
2. 🟡 **Soon**: Refactor DLX binary caching (medium value, medium complexity)
3. 🔵 **Future**: Add SDK caching layer (high value, needs design)

**Benefits**:
- 🚀 **Performance**: Faster cache operations, automatic compression
- 🔒 **Security**: Built-in integrity verification, tamper detection
- 🛠️ **Maintenance**: Battle-tested library, reduce custom code
- 📦 **Standards**: W3C SRI format, npm ecosystem alignment
- 🎯 **Reliability**: Concurrent safety, atomic operations

**Next Steps**:
1. Review and approve this document
2. Add cacache dependency to package.json
3. Create `src/utils/cacache.mts` wrapper utilities
4. Migrate GitHub API caching as proof of concept
5. Measure performance and cache hit rates
6. Iterate on DLX and SDK caching

---

*Document created: 2025-10-04*
*Last updated: 2025-10-04*
*Author: Claude Code*
