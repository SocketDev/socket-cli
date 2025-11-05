/**
 * @fileoverview Utility functions for Socket SDK operations.
 * Provides URL normalization, query parameter handling, and path resolution utilities.
 */
import path from 'node:path'

import { memoize } from '@socketsecurity/lib/memoization'
import { normalizePath } from '@socketsecurity/lib/path'

import type { QueryParams } from './types'

// Re-export user agent function for convenience
export { createUserAgentFromPkgJson } from './user-agent'

/**
 * Normalize base URL by ensuring it ends with a trailing slash.
 * Required for proper URL joining with relative paths.
 * Memoized for performance since base URLs are typically reused.
 */
export const normalizeBaseUrl = memoize(
  (baseUrl: string): string => {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  },
  { name: 'normalizeBaseUrl' },
)

/**
 * Create a promise with externally accessible resolve/reject functions.
 * Polyfill for Promise.withResolvers() on older Node.js versions.
 */
export function promiseWithResolvers<T>(): ReturnType<
  typeof Promise.withResolvers<T>
> {
  /* c8 ignore next 3 - polyfill for older Node versions without Promise.withResolvers */
  if (Promise.withResolvers) {
    return Promise.withResolvers<T>()
  }

  /* c8 ignore next 7 - polyfill implementation for older Node versions */
  const obj = {} as ReturnType<typeof Promise.withResolvers<T>>
  obj.promise = new Promise<T>((resolver, reject) => {
    obj.resolve = resolver
    obj.reject = reject
  })
  return obj
}

/**
 * Convert query parameters to URLSearchParams with API-compatible key normalization.
 * Transforms camelCase keys to snake_case and filters out empty values.
 */
export function queryToSearchParams(
  init?:
    | URLSearchParams
    | string
    | QueryParams
    | Iterable<[string, unknown]>
    | ReadonlyArray<[string, unknown]>
    | null
    | undefined,
): URLSearchParams {
  const params = new URLSearchParams(
    init as ConstructorParameters<typeof URLSearchParams>[0],
  )
  const normalized = { __proto__: null } as unknown as QueryParams
  const entries: Iterable<[string, string]> = params.entries()
  for (const entry of entries) {
    let key: string = entry[0]
    const value: string = entry[1]
    if (key === 'defaultBranch') {
      /* c8 ignore next - query parameter normalization for API compatibility */
      key = 'default_branch'
    } else if (key === 'perPage') {
      /* c8 ignore next 2 - query parameter normalization for API compatibility */
      key = 'per_page'
    }
    /* c8 ignore next - skip empty string values in params */
    if (value) {
      normalized[key] = value
    }
  }
  return new URLSearchParams(normalized as unknown as Record<string, string>)
}

/**
 * Convert relative file paths to absolute paths.
 * Resolves paths relative to specified base directory or current working directory.
 */
export function resolveAbsPaths(
  filepaths: string[],
  pathsRelativeTo?: string | undefined,
): string[] {
  const basePath = resolveBasePath(pathsRelativeTo)
  // Node's path.resolve will process path segments from right to left until
  // it creates a valid absolute path. So if `pathsRelativeTo` is an absolute
  // path, process.cwd() is not used, which is the common expectation. If none
  // of the paths resolve then it defaults to process.cwd().
  return filepaths.map(p => normalizePath(path.resolve(basePath, p)))
}

/**
 * Resolve base path to an absolute directory path.
 * Converts relative paths to absolute using current working directory as reference.
 */
export function resolveBasePath(pathsRelativeTo = '.'): string {
  // Node's path.resolve will process path segments from right to left until
  // it creates a valid absolute path. So if `pathsRelativeTo` is an absolute
  // path, process.cwd() is not used, which is the common expectation. If none
  // of the paths resolve then it defaults to process.cwd().
  return normalizePath(path.resolve(process.cwd(), pathsRelativeTo))
}
