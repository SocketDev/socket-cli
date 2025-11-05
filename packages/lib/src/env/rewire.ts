/**
 * @fileoverview Environment variable rewiring utilities for testing.
 * Uses AsyncLocalStorage for context-isolated overrides that work with concurrent tests.
 *
 * Features:
 * - Context-isolated overrides via withEnv() for advanced use cases
 * - Test-friendly setEnv/clearEnv/resetEnv that work in beforeEach/afterEach
 * - Compatible with vi.stubEnv() - reads from process.env as final fallback
 * - Thread-safe for concurrent test execution
 */

import { AsyncLocalStorage } from 'async_hooks'

type EnvOverrides = Map<string, string | undefined>

const envStorage = new AsyncLocalStorage<EnvOverrides>()

// Per-test overrides (used by setEnv/clearEnv/resetEnv in test hooks)
// Each test file gets its own instance due to Vitest's module isolation
const testOverrides = new Map<string, string | undefined>()

/**
 * Get an environment variable value, checking overrides first.
 *
 * Resolution order:
 * 1. AsyncLocalStorage context (set via withEnv)
 * 2. Test overrides (set via setEnv in beforeEach)
 * 3. process.env (including vi.stubEnv modifications)
 *
 * @internal Used by env getters to support test rewiring
 */
export function getEnvValue(key: string): string | undefined {
  // Check AsyncLocalStorage context first (highest priority)
  const contextOverrides = envStorage.getStore()
  if (contextOverrides?.has(key)) {
    return contextOverrides.get(key)
  }

  // Check test overrides (set via setEnv in beforeEach)
  if (testOverrides.has(key)) {
    return testOverrides.get(key)
  }

  // Fall back to process.env (works with vi.stubEnv)
  return process.env[key]
}

/**
 * Set an environment variable override for testing.
 * This does not modify process.env, only affects env getters.
 *
 * Works in test hooks (beforeEach) without needing AsyncLocalStorage context.
 * Vitest's module isolation ensures each test file has independent overrides.
 *
 * @example
 * ```typescript
 * import { setEnv, resetEnv } from '#env/rewire'
 * import { getCI } from '#env/ci'
 *
 * beforeEach(() => {
 *   setEnv('CI', '1')
 * })
 *
 * afterEach(() => {
 *   resetEnv()
 * })
 *
 * it('should detect CI environment', () => {
 *   expect(getCI()).toBe(true)
 * })
 * ```
 */
export function setEnv(key: string, value: string | undefined): void {
  testOverrides.set(key, value)
}

/**
 * Clear a specific environment variable override.
 */
export function clearEnv(key: string): void {
  testOverrides.delete(key)
}

/**
 * Clear all environment variable overrides.
 * Useful in afterEach hooks to ensure clean test state.
 *
 * @example
 * ```typescript
 * import { resetEnv } from '#env/rewire'
 *
 * afterEach(() => {
 *   resetEnv()
 * })
 * ```
 */
export function resetEnv(): void {
  testOverrides.clear()
}

/**
 * Check if an environment variable has been overridden.
 */
export function hasOverride(key: string): boolean {
  const contextOverrides = envStorage.getStore()
  return contextOverrides?.has(key) || testOverrides.has(key)
}

/**
 * Run code with environment overrides in an isolated AsyncLocalStorage context.
 * Creates true context isolation - overrides don't leak to concurrent code.
 *
 * Useful for tests that need temporary overrides without affecting other tests
 * or for nested override scenarios.
 *
 * @example
 * ```typescript
 * import { withEnv } from '#env/rewire'
 * import { getCI } from '#env/ci'
 *
 * // Temporary override in isolated context
 * await withEnv({ CI: '1' }, async () => {
 *   expect(getCI()).toBe(true)
 * })
 * expect(getCI()).toBe(false) // Override is gone
 * ```
 *
 * @example
 * ```typescript
 * // Nested overrides work correctly
 * setEnv('CI', '1') // Test-level override
 *
 * await withEnv({ CI: '0' }, async () => {
 *   expect(getCI()).toBe(false) // Context override takes precedence
 * })
 *
 * expect(getCI()).toBe(true) // Back to test-level override
 * ```
 */
export async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const map = new Map(Object.entries(overrides))
  return await envStorage.run(map, fn)
}

/**
 * Synchronous version of withEnv for non-async code.
 *
 * @example
 * ```typescript
 * import { withEnvSync } from '#env/rewire'
 * import { getCI } from '#env/ci'
 *
 * const result = withEnvSync({ CI: '1' }, () => {
 *   return getCI()
 * })
 * expect(result).toBe(true)
 * ```
 */
export function withEnvSync<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T,
): T {
  const map = new Map(Object.entries(overrides))
  return envStorage.run(map, fn)
}
