/** @fileoverview Output assertion helpers for Socket CLI tests. Provides fluent assertion API for validating CLI output, error messages, and exit codes. */

import { expect } from 'vitest'

import type { CliExecutionResult } from './cli-execution.mts'

/**
 * Fluent assertion builder for CLI output validation
 */
export class OutputAssertion {
  constructor(private readonly result: CliExecutionResult) {}

  /**
   * Assert stdout contains expected text
   */
  stdoutContains(expected: string | RegExp, message?: string): this {
    if (typeof expected === 'string') {
      expect(this.result.stdout, message).toContain(expected)
    } else {
      expect(this.result.stdout, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert stdout does not contain text
   */
  stdoutNotContains(notExpected: string | RegExp, message?: string): this {
    if (typeof notExpected === 'string') {
      expect(this.result.stdout, message).not.toContain(notExpected)
    } else {
      expect(this.result.stdout, message).not.toMatch(notExpected)
    }
    return this
  }

  /**
   * Assert stdout equals exact text
   */
  stdoutEquals(expected: string, message?: string): this {
    expect(this.result.stdout, message).toBe(expected)
    return this
  }

  /**
   * Assert stdout is empty
   */
  stdoutEmpty(message?: string): this {
    expect(this.result.stdout, message).toBe('')
    return this
  }

  /**
   * Assert stderr contains expected text
   */
  stderrContains(expected: string | RegExp, message?: string): this {
    if (typeof expected === 'string') {
      expect(this.result.stderr, message).toContain(expected)
    } else {
      expect(this.result.stderr, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert stderr does not contain text
   */
  stderrNotContains(notExpected: string | RegExp, message?: string): this {
    if (typeof notExpected === 'string') {
      expect(this.result.stderr, message).not.toContain(notExpected)
    } else {
      expect(this.result.stderr, message).not.toMatch(notExpected)
    }
    return this
  }

  /**
   * Assert stderr equals exact text
   */
  stderrEquals(expected: string, message?: string): this {
    expect(this.result.stderr, message).toBe(expected)
    return this
  }

  /**
   * Assert stderr is empty
   */
  stderrEmpty(message?: string): this {
    expect(this.result.stderr, message).toBe('')
    return this
  }

  /**
   * Assert combined output (stdout + stderr) contains text
   */
  outputContains(expected: string | RegExp, message?: string): this {
    if (typeof expected === 'string') {
      expect(this.result.output, message).toContain(expected)
    } else {
      expect(this.result.output, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert exit code equals expected value
   */
  exitCode(expected: number, message?: string): this {
    expect(this.result.code, message).toBe(expected)
    return this
  }

  /**
   * Assert command succeeded (exit code 0)
   */
  succeeded(message?: string): this {
    expect(this.result.status, message).toBe(true)
    expect(this.result.code, message).toBe(0)
    return this
  }

  /**
   * Assert command failed (non-zero exit code)
   */
  failed(message?: string): this {
    expect(this.result.status, message).toBe(false)
    expect(this.result.code, message).not.toBe(0)
    return this
  }

  /**
   * Assert error was thrown
   */
  hasError(message?: string): this {
    expect(this.result.error, message).toBeDefined()
    return this
  }

  /**
   * Assert error message contains text
   */
  errorContains(expected: string | RegExp, message?: string): this {
    expect(this.result.error, message).toBeDefined()
    if (typeof expected === 'string') {
      expect(this.result.error?.message, message).toContain(expected)
    } else {
      expect(this.result.error?.message, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert output matches snapshot
   */
  matchesSnapshot(snapshotName?: string): this {
    if (snapshotName) {
      expect(this.result.output).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.output).toMatchSnapshot()
    }
    return this
  }

  /**
   * Assert stdout matches snapshot
   */
  stdoutMatchesSnapshot(snapshotName?: string): this {
    if (snapshotName) {
      expect(this.result.stdout).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.stdout).toMatchSnapshot()
    }
    return this
  }

  /**
   * Assert stderr matches snapshot
   */
  stderrMatchesSnapshot(snapshotName?: string): this {
    if (snapshotName) {
      expect(this.result.stderr).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.stderr).toMatchSnapshot()
    }
    return this
  }

  /**
   * Get the raw result for custom assertions
   */
  get raw(): CliExecutionResult {
    return this.result
  }
}

/**
 * Create fluent assertion builder for CLI output validation.
 *
 * @param result - CLI execution result
 * @returns Fluent assertion builder
 *
 * @example
 * ```typescript
 * const result = await executeCliCommand(['scan', '--help'])
 * expectOutput(result)
 *   .succeeded()
 *   .stdoutContains('Usage')
 *   .stdoutContains('Options')
 *   .stderrEmpty()
 * ```
 */
export function expectOutput(result: CliExecutionResult): OutputAssertion {
  return new OutputAssertion(result)
}

/**
 * Assert stdout contains all expected strings.
 *
 * @param output - CLI output string
 * @param expected - Array of expected strings
 *
 * @example
 * ```typescript
 * expectStdoutContainsAll(result.stdout, ['scan', 'repository', 'success'])
 * ```
 */
export function expectStdoutContainsAll(
  output: string,
  expected: string[],
): void {
  for (const text of expected) {
    expect(output).toContain(text)
  }
}

/**
 * Assert stdout contains at least one of the expected strings.
 *
 * @param output - CLI output string
 * @param expected - Array of expected strings
 *
 * @example
 * ```typescript
 * expectStdoutContainsAny(result.stdout, ['success', 'completed', 'done'])
 * ```
 */
export function expectStdoutContainsAny(
  output: string,
  expected: string[],
): void {
  const found = expected.some(text => output.includes(text))
  expect(
    found,
    `Expected stdout to contain at least one of: ${expected.join(', ')}`,
  ).toBe(true)
}

/**
 * Assert output matches expected line count.
 *
 * @param output - CLI output string
 * @param expectedLines - Expected number of lines
 *
 * @example
 * ```typescript
 * expectLineCount(result.stdout, 5)
 * ```
 */
export function expectLineCount(output: string, expectedLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBe(expectedLines)
}

/**
 * Assert output has minimum line count.
 *
 * @param output - CLI output string
 * @param minLines - Minimum number of lines
 *
 * @example
 * ```typescript
 * expectMinLineCount(result.stdout, 3)
 * ```
 */
export function expectMinLineCount(output: string, minLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBeGreaterThanOrEqual(minLines)
}

/**
 * Assert output has maximum line count.
 *
 * @param output - CLI output string
 * @param maxLines - Maximum number of lines
 *
 * @example
 * ```typescript
 * expectMaxLineCount(result.stdout, 10)
 * ```
 */
export function expectMaxLineCount(output: string, maxLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBeLessThanOrEqual(maxLines)
}

/**
 * Assert exit code is one of the expected codes.
 *
 * @param result - CLI execution result
 * @param expectedCodes - Array of valid exit codes
 *
 * @example
 * ```typescript
 * expectExitCodeOneOf(result, [0, 1]) // Success or specific error
 * ```
 */
export function expectExitCodeOneOf(
  result: CliExecutionResult,
  expectedCodes: number[],
): void {
  expect(expectedCodes).toContain(result.code)
}

/**
 * Assert output contains expected patterns in order.
 *
 * @param output - CLI output string
 * @param patterns - Array of strings/regexes that should appear in order
 *
 * @example
 * ```typescript
 * expectOrderedPatterns(result.stdout, [
 *   'Starting scan',
 *   'Analyzing dependencies',
 *   'Scan complete'
 * ])
 * ```
 */
export function expectOrderedPatterns(
  output: string,
  patterns: Array<RegExp | string>,
): void {
  let lastIndex = -1

  for (const pattern of patterns) {
    const index =
      typeof pattern === 'string'
        ? output.indexOf(pattern, lastIndex + 1)
        : output.substring(lastIndex + 1).search(pattern) + lastIndex + 1

    expect(
      index,
      `Pattern "${pattern}" not found after previous pattern`,
    ).toBeGreaterThan(lastIndex)
    lastIndex = index
  }
}

/**
 * Assert output is valid JSON.
 *
 * @param output - CLI output string
 * @returns Parsed JSON object
 *
 * @example
 * ```typescript
 * const json = expectValidJson(result.stdout)
 * expect(json.status).toBe('success')
 * ```
 */
export function expectValidJson<T = unknown>(output: string): T {
  try {
    return JSON.parse(output) as T
  } catch (error) {
    throw new Error(
      `Expected valid JSON but got parse error: ${error instanceof Error ? error.message : String(error)}\nOutput: ${output}`,
    )
  }
}

/**
 * Assert output contains no ANSI color codes (is plain text).
 *
 * @param output - CLI output string
 *
 * @example
 * ```typescript
 * expectNoAnsiCodes(result.stdout)
 * ```
 */
export function expectNoAnsiCodes(output: string): void {
   
  const ansiPattern = /\u001b\[\d+m/
  expect(output).not.toMatch(ansiPattern)
}

/**
 * Assert output contains table-like structure (aligned columns).
 *
 * @param output - CLI output string
 *
 * @example
 * ```typescript
 * expectTableStructure(result.stdout)
 * ```
 */
export function expectTableStructure(output: string): void {
  const lines = output.split('\n').filter(line => line.trim())

  expect(lines.length, 'Expected at least 2 lines for table').toBeGreaterThan(1)

  // Check if lines have consistent structure (similar lengths or alignment)
  const lineLengths = lines.map(line => line.length)
  const avgLength =
    lineLengths.reduce((sum, len) => sum + len, 0) / lineLengths.length
  const maxDeviation = avgLength * 0.3 // Allow 30% deviation

  for (const length of lineLengths) {
    expect(Math.abs(length - avgLength)).toBeLessThan(maxDeviation)
  }
}
