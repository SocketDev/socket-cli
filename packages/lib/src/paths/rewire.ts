/**
 * @fileoverview Path rewiring utilities for testing.
 * Allows tests to override os.tmpdir() and os.homedir() without directly modifying them.
 *
 * Features:
 * - Test-friendly setPath/clearPath/resetPaths that work in beforeEach/afterEach
 * - Automatic cache invalidation for path-dependent modules
 * - Thread-safe for concurrent test execution
 */

// Per-test overrides
// Each test file gets its own instance due to Vitest's module isolation
const testOverrides = new Map<string, string | undefined>()

// Cache for computed values (cleared when overrides change)
const valueCache = new Map<string, string>()

// Cache invalidation callbacks - registered by modules that need to clear their caches
const cacheInvalidationCallbacks: Array<() => void> = []

/**
 * Clear a specific path override.
 */
export function clearPath(key: string): void {
  testOverrides.delete(key)
  // Invalidate all path-related caches
  invalidateCaches()
}

/**
 * Get a path value, checking overrides first.
 *
 * Resolution order:
 * 1. Test overrides (set via setPath in beforeEach)
 * 2. Cached value (for performance)
 * 3. Original function call (cached for subsequent calls)
 *
 * @internal Used by path getters to support test rewiring
 */
export function getPathValue(key: string, originalFn: () => string): string {
  // Check test overrides first
  if (testOverrides.has(key)) {
    return testOverrides.get(key) as string
  }

  // Check cache
  if (valueCache.has(key)) {
    return valueCache.get(key) as string
  }

  // Compute and cache
  const value = originalFn()
  valueCache.set(key, value)
  return value
}

/**
 * Check if a path has been overridden.
 */
export function hasOverride(key: string): boolean {
  return testOverrides.has(key)
}

/**
 * Invalidate all cached paths.
 * Called automatically when setPath/clearPath/resetPaths are used.
 * Can also be called manually for advanced testing scenarios.
 *
 * @internal Primarily for internal use, but exported for advanced testing
 */
export function invalidateCaches(): void {
  // Clear the value cache
  valueCache.clear()

  // Call registered callbacks
  for (const callback of cacheInvalidationCallbacks) {
    try {
      callback()
    } catch {
      // Ignore errors from cache invalidation
    }
  }
}

/**
 * Register a cache invalidation callback.
 * Called by modules that need to clear their caches when paths change.
 *
 * @internal Used by paths.ts and fs.ts
 */
export function registerCacheInvalidation(callback: () => void): void {
  cacheInvalidationCallbacks.push(callback)
}

/**
 * Clear all path overrides and reset caches.
 * Useful in afterEach hooks to ensure clean test state.
 *
 * @example
 * ```typescript
 * import { resetPaths } from '#paths/rewire'
 *
 * afterEach(() => {
 *   resetPaths()
 * })
 * ```
 */
export function resetPaths(): void {
  testOverrides.clear()
  // Invalidate all path-related caches
  invalidateCaches()
}

/**
 * Set a path override for testing.
 * This triggers cache invalidation for path-dependent modules.
 *
 * @example
 * ```typescript
 * import { setPath, resetPaths } from '#paths/rewire'
 * import { getOsTmpDir } from '#lib/paths'
 *
 * beforeEach(() => {
 *   setPath('tmpdir', '/custom/tmp')
 * })
 *
 * afterEach(() => {
 *   resetPaths()
 * })
 *
 * it('should use custom temp directory', () => {
 *   expect(getOsTmpDir()).toBe('/custom/tmp')
 * })
 * ```
 */
export function setPath(key: string, value: string | undefined): void {
  testOverrides.set(key, value)
  // Invalidate all path-related caches
  invalidateCaches()
}
