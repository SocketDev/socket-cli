/** @fileoverview Result validation utilities for Socket CLI. Provides helpers for working with CResult type including validation and unwrapping. */

import type { CResult } from '../types.mts'

/**
 * Error options for ResultError
 */
export type ResultErrorOptions = {
  code?: number | undefined
  cause?: string | undefined
}

/**
 * Result validation error thrown when a CResult is not ok
 */
export class ResultError extends Error {
  code?: number | undefined
  override cause?: string | undefined

  constructor(message: string, options?: ResultErrorOptions | undefined) {
    super(message)
    this.name = 'ResultError'
    const opts = { __proto__: null, ...options } as ResultErrorOptions
    if (opts.code !== undefined) {
      this.code = opts.code
    }
    if (opts.cause !== undefined) {
      this.cause = opts.cause
    }
  }
}

/**
 * Requires a CResult to be ok, otherwise throws a ResultError
 *
 * @param result - The CResult to validate
 * @param context - Context string describing the operation
 * @returns The unwrapped data if result is ok
 * @throws {ResultError} If result is not ok
 *
 * @example
 * const repos = requireOk(
 *   await fetchListRepos(orgSlug),
 *   'fetch repositories'
 * )
 */
export function requireOk<T>(result: CResult<T>, context: string): T {
  if (!result.ok) {
    const errorOptions = { __proto__: null } as ResultErrorOptions
    if (result.code !== undefined) {
      errorOptions.code = result.code
    }
    if (result.cause !== undefined) {
      errorOptions.cause = result.cause
    }
    throw new ResultError(`${context}: ${result.message}`, errorOptions)
  }
  return result.data
}

/**
 * Checks if a CResult is ok
 *
 * @param result - The CResult to check
 * @returns true if result is ok, false otherwise
 */
export function isOk<T>(
  result: CResult<T>,
): result is Extract<CResult<T>, { ok: true }> {
  return result.ok
}

/**
 * Checks if a CResult is an error
 *
 * @param result - The CResult to check
 * @returns true if result is an error, false otherwise
 */
export function isError<T>(
  result: CResult<T>,
): result is Extract<CResult<T>, { ok: false }> {
  return !result.ok
}

/**
 * Maps the data of a successful CResult, or passes through an error
 *
 * @param result - The CResult to map
 * @param fn - Function to transform the data
 * @returns A new CResult with mapped data or the original error
 *
 * @example
 * const repoNames = mapResult(
 *   await fetchListRepos(orgSlug),
 *   (repos) => repos.map(r => r.name)
 * )
 */
export function mapResult<T, U>(
  result: CResult<T>,
  fn: (data: T) => U,
): CResult<U> {
  if (!result.ok) {
    return result
  }
  return {
    ok: true,
    data: fn(result.data),
    message: result.message,
  }
}

/**
 * Chains CResult operations, passing through errors
 *
 * @param result - The CResult to chain from
 * @param fn - Function that returns a new CResult
 * @returns The result of fn if input is ok, otherwise the error
 *
 * @example
 * const result = await chainResult(
 *   await fetchRepo(orgSlug, repoName),
 *   async (repo) => await updateRepo(repo.id, updates)
 * )
 */
export async function chainResult<T, U>(
  result: CResult<T>,
  fn: (data: T) => Promise<CResult<U>>,
): Promise<CResult<U>> {
  if (!result.ok) {
    return result
  }
  return await fn(result.data)
}

/**
 * Unwraps a CResult, returning the data or undefined if error
 *
 * @param result - The CResult to unwrap
 * @returns The data if ok, undefined otherwise
 */
export function unwrapOr<T>(result: CResult<T>, defaultValue: T): T {
  return result.ok ? result.data : defaultValue
}

/**
 * Unwraps a CResult, returning the data or null if error
 *
 * @param result - The CResult to unwrap
 * @returns The data if ok, null otherwise
 */
export function unwrapOrNull<T>(result: CResult<T>): T | null {
  return result.ok ? result.data : null
}

/**
 * Unwraps a CResult, returning the data or undefined if error
 *
 * @param result - The CResult to unwrap
 * @returns The data if ok, undefined otherwise
 */
export function unwrapOrUndefined<T>(result: CResult<T>): T | undefined {
  return result.ok ? result.data : undefined
}

/**
 * Converts a CResult to a Result<T, Error> pattern
 *
 * @param result - The CResult to convert
 * @returns An object with either data or error property
 */
export function toResultPattern<T>(
  result: CResult<T>,
): { ok: true; data: T } | { ok: false; error: Error } {
  if (result.ok) {
    return { ok: true, data: result.data }
  }
  const error = new Error(result.message)
  if (result.cause) {
    error.cause = result.cause
  }
  return { ok: false, error }
}
