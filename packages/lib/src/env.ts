/**
 * @fileoverview Environment variable parsing and conversion utilities.
 * Provides type-safe conversion functions for boolean, number, and string values.
 */

const NumberCtor = Number
// IMPORTANT: Do not use destructuring here - use direct assignment instead.
// tsgo has a bug that incorrectly transpiles destructured exports, resulting in
// `exports.SomeName = void 0;` which causes runtime errors.
// See: https://github.com/SocketDev/socket-packageurl-js/issues/3
const NumberIsFinite = Number.isFinite
const NumberParseInt = Number.parseInt
const StringCtor = String

// Common environment variables that have case sensitivity issues on Windows.
// These are checked with case-insensitive matching when exact matches fail.
const caseInsensitiveKeys = new Set([
  'APPDATA',
  'COMSPEC',
  'HOME',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'PROGRAMFILES',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
])

/**
 * Create a case-insensitive environment variable Proxy for Windows compatibility.
 * On Windows, environment variables are case-insensitive (PATH vs Path vs path).
 * This Proxy provides consistent access regardless of case, with priority given
 * to exact matches, then case-insensitive matches for known vars.
 *
 * **Use Cases:**
 * - Cross-platform test environments needing consistent env var access
 * - Windows compatibility when passing env to child processes
 * - Merging environment overrides while preserving case-insensitive lookups
 *
 * **Performance Note:**
 * Proxy operations have runtime overhead. Only use when Windows case-insensitive
 * access is required. For most use cases, process.env directly is sufficient.
 *
 * @param base - Base environment object (usually process.env)
 * @param overrides - Optional overrides to merge
 * @returns Proxy that handles case-insensitive env var access
 *
 * @example
 * // Create a Proxy with overrides
 * const env = createEnvProxy(process.env, { NODE_ENV: 'test' })
 * console.log(env.PATH)  // Works with any case: PATH, Path, path
 * console.log(env.NODE_ENV)  // 'test'
 *
 * @example
 * // Pass to child process spawn
 * import { createEnvProxy } from '@socketsecurity/lib/env'
 * import { spawn } from '@socketsecurity/lib/spawn'
 *
 * spawn('node', ['script.js'], {
 *   env: createEnvProxy(process.env, { NODE_ENV: 'test' })
 * })
 */
export function createEnvProxy(
  base: NodeJS.ProcessEnv,
  overrides?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') {
          return undefined
        }

        // Priority 1: Check overrides for exact match.
        if (overrides && prop in overrides) {
          return overrides[prop]
        }

        // Priority 2: Check base for exact match.
        if (prop in base) {
          return base[prop]
        }

        // Priority 3: Case-insensitive lookup for known keys.
        const upperProp = prop.toUpperCase()
        if (caseInsensitiveKeys.has(upperProp)) {
          // Check overrides with case variations.
          if (overrides) {
            const key = findCaseInsensitiveEnvKey(overrides, upperProp)
            if (key !== undefined) {
              return overrides[key]
            }
          }
          // Check base with case variations.
          const key = findCaseInsensitiveEnvKey(base, upperProp)
          if (key !== undefined) {
            return base[key]
          }
        }

        return undefined
      },

      ownKeys(_target) {
        const keys = new Set<string>([
          ...Object.keys(base),
          ...(overrides ? Object.keys(overrides) : []),
        ])
        return [...keys]
      },

      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop !== 'string') {
          return undefined
        }

        // Use the same lookup logic as get().
        const value = this.get?.(_target, prop, _target)
        return value !== undefined
          ? {
              enumerable: true,
              configurable: true,
              writable: true,
              value,
            }
          : undefined
      },

      has(_target, prop) {
        if (typeof prop !== 'string') {
          return false
        }

        // Check overrides.
        if (overrides && prop in overrides) {
          return true
        }

        // Check base.
        if (prop in base) {
          return true
        }

        // Case-insensitive check.
        const upperProp = prop.toUpperCase()
        if (caseInsensitiveKeys.has(upperProp)) {
          if (
            overrides &&
            findCaseInsensitiveEnvKey(overrides, upperProp) !== undefined
          ) {
            return true
          }
          if (findCaseInsensitiveEnvKey(base, upperProp) !== undefined) {
            return true
          }
        }

        return false
      },

      set(_target, prop, value) {
        if (typeof prop === 'string' && overrides) {
          overrides[prop] = value
          return true
        }
        return false
      },
    },
  ) as NodeJS.ProcessEnv
}

/**
 * Convert an environment variable value to a boolean.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '1' || trimmed.toLowerCase() === 'true'
  }
  if (value === null || value === undefined) {
    return !!defaultValue
  }
  return !!value
}

/**
 * Convert an environment variable value to a number.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsNumber(value: unknown, defaultValue = 0): number {
  const numOrNaN = NumberParseInt(String(value), 10)
  const numMayBeNegZero = NumberIsFinite(numOrNaN)
    ? numOrNaN
    : NumberCtor(defaultValue)
  // Ensure -0 is treated as 0.
  return numMayBeNegZero || 0
}

/**
 * Convert an environment variable value to a trimmed string.
 */
/*@__NO_SIDE_EFFECTS__*/
export function envAsString(value: unknown, defaultValue = ''): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value === null || value === undefined) {
    return defaultValue === '' ? defaultValue : StringCtor(defaultValue).trim()
  }
  return StringCtor(value).trim()
}

/**
 * Find a case-insensitive environment variable key match.
 * Searches for an environment variable key that matches the given uppercase name,
 * using optimized fast-path checks to minimize expensive toUpperCase() calls.
 *
 * **Use Cases:**
 * - Finding PATH when env object has "Path" or "path"
 * - Cross-platform env var access where case may vary
 * - Custom case-insensitive env lookups
 *
 * **Performance:**
 * - Fast path: Checks length first (O(1)) before toUpperCase (expensive)
 * - Only converts to uppercase when length matches
 * - Early exit on first match
 *
 * @param env - Environment object or env-like record to search
 * @param upperEnvVarName - Uppercase environment variable name to find (e.g., 'PATH')
 * @returns The actual key from env that matches (e.g., 'Path'), or undefined
 *
 * @example
 * // Find PATH regardless of case
 * const envObj = { Path: 'C:\\Windows', NODE_ENV: 'test' }
 * const key = findCaseInsensitiveEnvKey(envObj, 'PATH')
 * console.log(key)  // 'Path'
 * console.log(envObj[key])  // 'C:\\Windows'
 *
 * @example
 * // Not found returns undefined
 * const key = findCaseInsensitiveEnvKey({}, 'MISSING')
 * console.log(key)  // undefined
 */
export function findCaseInsensitiveEnvKey(
  env: Record<string, string | undefined>,
  upperEnvVarName: string,
): string | undefined {
  const targetLength = upperEnvVarName.length
  for (const key of Object.keys(env)) {
    // Fast path: bail early if lengths don't match.
    if (key.length !== targetLength) {
      continue
    }
    // Only call toUpperCase if length matches.
    if (key.toUpperCase() === upperEnvVarName) {
      return key
    }
  }
  return undefined
}
