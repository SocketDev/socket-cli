/** @fileoverview Result assertion helpers for Socket CLI CResult pattern. Provides type-safe assertion utilities for validating CResult<T> success/error responses throughout the CLI codebase. */

import { expect } from 'vitest'

import type { CResult } from '../../src/types.mts'

/**
 * Fluent assertion builder for CResult validation
 */
export class ResultAssertion<T> {
  private readonly result: CResult<T>

  constructor(result: CResult<T>) {
    this.result = result
  }

  /**
   * Assert result is successful (ok: true)
   */
  isSuccess(message?: string): this {
    expect(this.result.ok, message).toBe(true)
    return this
  }

  /**
   * Assert result is failure (ok: false)
   */
  isFailure(message?: string): this {
    expect(this.result.ok, message).toBe(false)
    return this
  }

  /**
   * Assert result has data property (implies success)
   */
  hasData(message?: string): this {
    this.isSuccess(message)
    expect((this.result as { data: T }).data, message).toBeDefined()
    return this
  }

  /**
   * Assert data matches expected value
   */
  dataEquals(expected: T, message?: string): this {
    this.isSuccess(message)
    expect((this.result as { data: T }).data, message).toEqual(expected)
    return this
  }

  /**
   * Assert data contains expected properties
   */
  dataContains(expected: Partial<T>, message?: string): this {
    this.isSuccess(message)
    const data = (this.result as { data: T }).data
    expect(data, message).toMatchObject(expected)
    return this
  }

  /**
   * Assert result has error message
   */
  hasMessage(message?: string): this {
    this.isFailure(message)
    expect((this.result as { message: string }).message, message).toBeDefined()
    return this
  }

  /**
   * Assert error message equals expected value
   */
  messageEquals(expected: string, message?: string): this {
    this.isFailure(message)
    expect((this.result as { message: string }).message, message).toBe(expected)
    return this
  }

  /**
   * Assert error message contains text
   */
  messageContains(expected: string | RegExp, message?: string): this {
    this.isFailure(message)
    const errorMessage = (this.result as { message: string }).message
    if (typeof expected === 'string') {
      expect(errorMessage, message).toContain(expected)
    } else {
      expect(errorMessage, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert result has error code
   */
  hasCode(expectedCode: number, message?: string): this {
    this.isFailure(message)
    expect((this.result as { code: number }).code, message).toBe(expectedCode)
    return this
  }

  /**
   * Assert result has cause property
   */
  hasCause(message?: string): this {
    this.isFailure(message)
    expect((this.result as { cause?: string }).cause, message).toBeDefined()
    return this
  }

  /**
   * Assert cause contains text
   */
  causeContains(expected: string | RegExp, message?: string): this {
    this.isFailure(message)
    const cause = (this.result as { cause?: string }).cause
    expect(cause, message).toBeDefined()
    if (typeof expected === 'string') {
      expect(cause, message).toContain(expected)
    } else {
      expect(cause, message).toMatch(expected)
    }
    return this
  }

  /**
   * Execute callback with data if result is success
   */
  withData(callback: (data: T) => void): this {
    if (this.result.ok) {
      callback((this.result as { data: T }).data)
    }
    return this
  }

  /**
   * Execute callback with error info if result is failure
   */
  withError(
    callback: (error: {
      message: string
      code?: number
      cause?: string
    }) => void,
  ): this {
    if (!this.result.ok) {
      const error = this.result as {
        message: string
        code?: number
        cause?: string
      }
      callback(error)
    }
    return this
  }

  /**
   * Get the raw result for custom assertions
   */
  get raw(): CResult<T> {
    return this.result
  }
}

/**
 * Create fluent assertion builder for CResult validation.
 *
 * @param result - CResult to validate
 * @returns Fluent assertion builder
 *
 * @example
 * ```typescript
 * const result = await mockApiCall()
 * expectResult(result)
 *   .isSuccess()
 *   .hasData()
 *   .dataContains({ id: 'scan-123' })
 * ```
 */
export function expectResult<T>(result: CResult<T>): ResultAssertion<T> {
  return new ResultAssertion(result)
}

/**
 * Assert CResult is successful and return data with type narrowing.
 *
 * @param result - CResult to validate
 * @returns Data from successful result
 * @throws Error if result is not successful
 *
 * @example
 * ```typescript
 * const data = expectSuccess(result)
 * expect(data.id).toBeDefined()
 * ```
 */
export function expectSuccess<T>(result: CResult<T>): T {
  if (!result.ok) {
    throw new Error(
      `Expected successful result but got error: ${(result as { message: string }).message}`,
    )
  }
  return (result as { data: T }).data
}

/**
 * Assert CResult is failure and return error info with type narrowing.
 *
 * @param result - CResult to validate
 * @returns Error information from failed result
 * @throws Error if result is successful
 *
 * @example
 * ```typescript
 * const error = expectFailure(result)
 * expect(error.message).toContain('not found')
 * expect(error.code).toBe(404)
 * ```
 */
export function expectFailure<T>(result: CResult<T>): {
  code?: number
  cause?: string
  message: string
} {
  if (result.ok) {
    throw new Error('Expected failed result but got success')
  }
  return result as { code?: number; cause?: string; message: string }
}

/**
 * Assert CResult is successful and data matches expected value.
 *
 * @param result - CResult to validate
 * @param expected - Expected data value
 *
 * @example
 * ```typescript
 * expectSuccessWithData(result, { id: 'scan-123', status: 'completed' })
 * ```
 */
export function expectSuccessWithData<T>(
  result: CResult<T>,
  expected: T,
): void {
  expect(result.ok).toBe(true)
  expect((result as { data: T }).data).toEqual(expected)
}

/**
 * Assert CResult is failure with expected error message.
 *
 * @param result - CResult to validate
 * @param expectedMessage - Expected error message
 * @param expectedCode - Optional expected error code
 *
 * @example
 * ```typescript
 * expectFailureWithMessage(result, 'Repository not found', 404)
 * ```
 */
export function expectFailureWithMessage<T>(
  result: CResult<T>,
  expectedMessage: string | RegExp,
  expectedCode?: number | undefined,
): void {
  expect(result.ok).toBe(false)
  const error = result as { code?: number; message: string }

  if (typeof expectedMessage === 'string') {
    expect(error.message).toContain(expectedMessage)
  } else {
    expect(error.message).toMatch(expectedMessage)
  }

  if (expectedCode !== undefined) {
    expect(error.code).toBe(expectedCode)
  }
}

/**
 * Assert CResult data has expected properties.
 *
 * @param result - CResult to validate
 * @param expectedProps - Expected property names
 *
 * @example
 * ```typescript
 * expectResultHasProperties(result, ['id', 'name', 'status'])
 * ```
 */
export function expectResultHasProperties<T>(
  result: CResult<T>,
  expectedProps: Array<keyof T>,
): void {
  expect(result.ok).toBe(true)
  const data = (result as { data: T }).data

  for (const prop of expectedProps) {
    expect(data).toHaveProperty(prop as string)
  }
}

/**
 * Assert CResult matches expected type structure.
 * Useful for validating complex nested types.
 *
 * @param result - CResult to validate
 * @param validator - Validation function that returns true if valid
 *
 * @example
 * ```typescript
 * expectResultMatchesType(result, (data): data is ScanResult => {
 *   return typeof data.id === 'string' && Array.isArray(data.issues)
 * })
 * ```
 */
export function expectResultMatchesType<T, U extends T>(
  result: CResult<T>,
  validator: (data: T) => data is U,
): asserts result is CResult<U> {
  expect(result.ok).toBe(true)
  const data = (result as { data: T }).data
  expect(validator(data)).toBe(true)
}

/**
 * Assert array of CResults all succeeded.
 *
 * @param results - Array of CResults to validate
 *
 * @example
 * ```typescript
 * expectAllSuccess([result1, result2, result3])
 * ```
 */
export function expectAllSuccess<T>(results: Array<CResult<T>>): void {
  const failures = results.filter(r => !r.ok)
  if (failures.length > 0) {
    const messages = failures.map(f => (f as { message: string }).message)
    throw new Error(
      `Expected all results to succeed, but ${failures.length} failed:\n${messages.join('\n')}`,
    )
  }
}

/**
 * Assert at least one CResult succeeded.
 *
 * @param results - Array of CResults to validate
 *
 * @example
 * ```typescript
 * expectAnySuccess([result1, result2, result3])
 * ```
 */
export function expectAnySuccess<T>(results: Array<CResult<T>>): void {
  const hasSuccess = results.some(r => r.ok)
  expect(hasSuccess, 'Expected at least one result to succeed').toBe(true)
}

/**
 * Assert CResult error code is one of expected codes.
 *
 * @param result - CResult to validate
 * @param expectedCodes - Array of valid error codes
 *
 * @example
 * ```typescript
 * expectErrorCodeOneOf(result, [401, 403, 404])
 * ```
 */
export function expectErrorCodeOneOf<T>(
  result: CResult<T>,
  expectedCodes: number[],
): void {
  expect(result.ok).toBe(false)
  const code = (result as { code?: number }).code
  expect(code).toBeDefined()
  expect(expectedCodes).toContain(code)
}

/**
 * Extract data from array of successful CResults.
 *
 * @param results - Array of CResults
 * @returns Array of data from successful results
 *
 * @example
 * ```typescript
 * const data = extractSuccessData([result1, result2, result3])
 * expect(data).toHaveLength(2)
 * ```
 */
export function extractSuccessData<T>(results: Array<CResult<T>>): T[] {
  return results
    .filter((r): r is { ok: true; data: T } => r.ok)
    .map(r => r.data)
}

/**
 * Extract error messages from array of failed CResults.
 *
 * @param results - Array of CResults
 * @returns Array of error messages from failed results
 *
 * @example
 * ```typescript
 * const errors = extractErrorMessages([result1, result2, result3])
 * expect(errors).toContain('not found')
 * ```
 */
export function extractErrorMessages<T>(results: Array<CResult<T>>): string[] {
  return results
    .filter((r): r is { ok: false; message: string } => !r.ok)
    .map(r => r.message)
}
