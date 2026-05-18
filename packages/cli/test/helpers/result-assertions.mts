/**
 * @file Result assertion helpers for Socket CLI CResult pattern. Provides
 *   type-safe assertion utilities for validating CResult<T> success/error
 *   responses throughout the CLI codebase.
 */

import { expect } from 'vitest'

import type { CResult } from '../../src/types.mts'

/**
 * Fluent assertion builder for CResult validation.
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
   * Assert data matches expected value.
   */
  dataEquals(expected: T, message?: string): this {
    this.isSuccess(message)
    expect((this.result as { data: T }).data, message).toEqual(expected)
    return this
  }

  /**
   * Assert data contains expected properties.
   */
  dataContains(expected: Partial<T>, message?: string): this {
    this.isSuccess(message)
    const data = (this.result as { data: T }).data
    expect(data, message).toMatchObject(expected)
    return this
  }

  /**
   * Assert result has error message.
   */
  hasMessage(message?: string): this {
    this.isFailure(message)
    expect((this.result as { message: string }).message, message).toBeDefined()
    return this
  }

  /**
   * Assert error message equals expected value.
   */
  messageEquals(expected: string, message?: string): this {
    this.isFailure(message)
    expect((this.result as { message: string }).message, message).toBe(expected)
    return this
  }

  /**
   * Assert error message contains text.
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
   * Assert result has error code.
   */
  hasCode(expectedCode: number, message?: string): this {
    this.isFailure(message)
    expect((this.result as { code: number }).code, message).toBe(expectedCode)
    return this
  }

  /**
   * Assert result has cause property.
   */
  hasCause(message?: string): this {
    this.isFailure(message)
    expect(
      (this.result as { cause?: string | undefined }).cause,
      message,
    ).toBeDefined()
    return this
  }

  /**
   * Assert cause contains text.
   */
  causeContains(expected: string | RegExp, message?: string): this {
    this.isFailure(message)
    const cause = (this.result as { cause?: string | undefined }).cause
    expect(cause, message).toBeDefined()
    if (typeof expected === 'string') {
      expect(cause, message).toContain(expected)
    } else {
      expect(cause, message).toMatch(expected)
    }
    return this
  }

  /**
   * Execute callback with data if result is success.
   */
  withData(callback: (data: T) => void): this {
    if (this.result.ok) {
      callback((this.result as { data: T }).data)
    }
    return this
  }

  /**
   * Execute callback with error info if result is failure.
   */
  withError(
    callback: (error: {
      message: string
      code?: number | undefined
      cause?: string | undefined
    }) => void,
  ): this {
    if (!this.result.ok) {
      const error = this.result as {
        message: string
        code?: number | undefined
        cause?: string | undefined
      }
      callback(error)
    }
    return this
  }

  /**
   * Get the raw result for custom assertions.
   */
  get raw(): CResult<T> {
    return this.result
  }
}

/**
 * Assert array of CResults all succeeded.
 *
 * @example
 *   ```typescript
 *   expectAllSuccess([result1, result2, result3])
 *   ```
 *
 * @param results - Array of CResults to validate.
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
 * @example
 *   ```typescript
 *   expectAnySuccess([result1, result2, result3])
 *   ```
 *
 * @param results - Array of CResults to validate.
 */
export function expectAnySuccess<T>(results: Array<CResult<T>>): void {
  const hasSuccess = results.some(r => r.ok)
  expect(hasSuccess, 'Expected at least one result to succeed').toBe(true)
}

/**
 * Assert CResult error code is one of expected codes.
 *
 * @example
 *   ```typescript
 *   expectErrorCodeOneOf(result, [401, 403, 404])
 *   ```
 *
 * @param result - CResult to validate.
 * @param expectedCodes - Array of valid error codes.
 */
export function expectErrorCodeOneOf<T>(
  result: CResult<T>,
  expectedCodes: number[],
): void {
  expect(result.ok).toBe(false)
  const code = (result as { code?: number | undefined }).code
  expect(code).toBeDefined()
  expect(expectedCodes).toContain(code)
}

/**
 * Assert CResult is failure and return error info with type narrowing.
 *
 * @example
 *   ```typescript
 *   const error = expectFailure(result)
 *   expect(error.message).toContain('not found')
 *   expect(error.code).toBe(404)
 *   ```
 *
 * @param result - CResult to validate.
 *
 * @returns Error information from failed result
 *
 * @throws Error if result is successful
 */
export function expectFailure<T>(result: CResult<T>): {
  code?: number | undefined
  cause?: string | undefined
  message: string
} {
  if (result.ok) {
    throw new Error('Expected failed result but got success')
  }
  return result as {
    code?: number | undefined
    cause?: string | undefined
    message: string
  }
}

/**
 * Assert CResult is failure with expected error message.
 *
 * @example
 *   ```typescript
 *   expectFailureWithMessage(result, 'Repository not found', 404)
 *   ```
 *
 * @param result - CResult to validate.
 * @param expectedMessage - Expected error message.
 * @param expectedCode - Optional expected error code.
 */
export function expectFailureWithMessage<T>(
  result: CResult<T>,
  expectedMessage: string | RegExp,
  expectedCode?: number | undefined,
): void {
  expect(result.ok).toBe(false)
  const error = result as { code?: number | undefined; message: string }

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
 * Create fluent assertion builder for CResult validation.
 *
 * @example
 *   ```typescript
 *   const result = await mockApiCall()
 *   expectResult(result).isSuccess().hasData().dataContains({ id: 'scan-123' })
 *   ```
 *
 * @param result - CResult to validate.
 *
 * @returns Fluent assertion builder
 */
export function expectResult<T>(result: CResult<T>): ResultAssertion<T> {
  return new ResultAssertion(result)
}

/**
 * Assert CResult data has expected properties.
 *
 * @example
 *   ```typescript
 *   expectResultHasProperties(result, ['id', 'name', 'status'])
 *   ```
 *
 * @param result - CResult to validate.
 * @param expectedProps - Expected property names.
 */
export function expectResultHasProperties<T>(
  result: CResult<T>,
  expectedProps: Array<keyof T>,
): void {
  expect(result.ok).toBe(true)
  const data = (result as { data: T }).data

  for (let i = 0, { length } = expectedProps; i < length; i += 1) {
    const prop = expectedProps[i]
    expect(data).toHaveProperty(prop as string)
  }
}

/**
 * Assert CResult matches expected type structure. Useful for validating complex
 * nested types.
 *
 * @example
 *   ```typescript
 *   expectResultMatchesType(result, (data): data is ScanResult => {
 *     return typeof data.id === 'string' && Array.isArray(data.issues)
 *   })
 *   ```
 *
 * @param result - CResult to validate.
 * @param validator - Validation function that returns true if valid.
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
 * Assert CResult is successful and return data with type narrowing.
 *
 * @example
 *   ```typescript
 *   const data = expectSuccess(result)
 *   expect(data.id).toBeDefined()
 *   ```
 *
 * @param result - CResult to validate.
 *
 * @returns Data from successful result
 *
 * @throws Error if result is not successful
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
 * Assert CResult is successful and data matches expected value.
 *
 * @example
 *   ```typescript
 *   expectSuccessWithData(result, { id: 'scan-123', status: 'completed' })
 *   ```
 *
 * @param result - CResult to validate.
 * @param expected - Expected data value.
 */
export function expectSuccessWithData<T>(
  result: CResult<T>,
  expected: T,
): void {
  expect(result.ok).toBe(true)
  expect((result as { data: T }).data).toEqual(expected)
}

/**
 * Extract error messages from array of failed CResults.
 *
 * @example
 *   ```typescript
 *   const errors = extractErrorMessages([result1, result2, result3])
 *   expect(errors).toContain('not found')
 *   ```
 *
 * @param results - Array of CResults.
 *
 * @returns Array of error messages from failed results
 */
export function extractErrorMessages<T>(results: Array<CResult<T>>): string[] {
  return results
    .filter((r): r is { ok: false; message: string } => !r.ok)
    .map(r => r.message)
}

/**
 * Extract data from array of successful CResults.
 *
 * @example
 *   ```typescript
 *   const data = extractSuccessData([result1, result2, result3])
 *   expect(data).toHaveLength(2)
 *   ```
 *
 * @param results - Array of CResults.
 *
 * @returns Array of data from successful results
 */
export function extractSuccessData<T>(results: Array<CResult<T>>): T[] {
  return results
    .filter((r): r is { ok: true; data: T } => r.ok)
    .map(r => r.data)
}
