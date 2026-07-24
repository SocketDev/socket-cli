/**
 * @file Fluent assertion builder for Socket CLI test output. Chains stdout /
 *   stderr / exit-code / snapshot assertions on a `CliExecutionResult`. The
 *   standalone `expect*` helpers live in `./output-assertions.mts`.
 */

import { expect } from 'vitest'

import type { CliExecutionResult } from './cli-execution.mts'

/**
 * Fluent assertion builder for CLI output validation.
 */
export class OutputAssertion {
  private readonly result: CliExecutionResult

  constructor(result: CliExecutionResult) {
    this.result = result
  }

  /**
   * Assert stdout contains expected text.
   */
  stdoutContains(
    expected: string | RegExp,
    message?: string | undefined,
  ): this {
    if (typeof expected === 'string') {
      expect(this.result.stdout, message).toContain(expected)
    } else {
      expect(this.result.stdout, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert stdout does not contain text.
   */
  stdoutNotContains(
    notExpected: string | RegExp,
    message?: string | undefined,
  ): this {
    if (typeof notExpected === 'string') {
      expect(this.result.stdout, message).not.toContain(notExpected)
    } else {
      expect(this.result.stdout, message).not.toMatch(notExpected)
    }
    return this
  }

  /**
   * Assert stdout equals exact text.
   */
  stdoutEquals(expected: string, message?: string | undefined): this {
    expect(this.result.stdout, message).toBe(expected)
    return this
  }

  /**
   * Assert stdout is empty.
   */
  stdoutEmpty(message?: string | undefined): this {
    expect(this.result.stdout, message).toBe('')
    return this
  }

  /**
   * Assert stderr contains expected text.
   */
  stderrContains(
    expected: string | RegExp,
    message?: string | undefined,
  ): this {
    if (typeof expected === 'string') {
      expect(this.result.stderr, message).toContain(expected)
    } else {
      expect(this.result.stderr, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert stderr does not contain text.
   */
  stderrNotContains(
    notExpected: string | RegExp,
    message?: string | undefined,
  ): this {
    if (typeof notExpected === 'string') {
      expect(this.result.stderr, message).not.toContain(notExpected)
    } else {
      expect(this.result.stderr, message).not.toMatch(notExpected)
    }
    return this
  }

  /**
   * Assert stderr equals exact text.
   */
  stderrEquals(expected: string, message?: string | undefined): this {
    expect(this.result.stderr, message).toBe(expected)
    return this
  }

  /**
   * Assert stderr is empty.
   */
  stderrEmpty(message?: string | undefined): this {
    expect(this.result.stderr, message).toBe('')
    return this
  }

  /**
   * Assert combined output (stdout + stderr) contains text.
   */
  outputContains(
    expected: string | RegExp,
    message?: string | undefined,
  ): this {
    if (typeof expected === 'string') {
      expect(this.result.output, message).toContain(expected)
    } else {
      expect(this.result.output, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert exit code equals expected value.
   */
  exitCode(expected: number, message?: string | undefined): this {
    expect(this.result.code, message).toBe(expected)
    return this
  }

  /**
   * Assert command succeeded (exit code 0)
   */
  succeeded(message?: string | undefined): this {
    expect(this.result.status, message).toBe(true)
    expect(this.result.code, message).toBe(0)
    return this
  }

  /**
   * Assert command failed (non-zero exit code)
   */
  failed(message?: string | undefined): this {
    expect(this.result.status, message).toBe(false)
    expect(this.result.code, message).not.toBe(0)
    return this
  }

  /**
   * Assert error was thrown.
   */
  hasError(message?: string | undefined): this {
    expect(this.result.error, message).toBeDefined()
    return this
  }

  /**
   * Assert error message contains text.
   */
  errorContains(expected: string | RegExp, message?: string | undefined): this {
    expect(this.result.error, message).toBeDefined()
    if (typeof expected === 'string') {
      expect(this.result.error?.message, message).toContain(expected)
    } else {
      expect(this.result.error?.message, message).toMatch(expected)
    }
    return this
  }

  /**
   * Assert output matches snapshot.
   */
  matchesSnapshot(snapshotName?: string | undefined): this {
    if (snapshotName) {
      expect(this.result.output).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.output).toMatchSnapshot()
    }
    return this
  }

  /**
   * Assert stdout matches snapshot.
   */
  stdoutMatchesSnapshot(snapshotName?: string | undefined): this {
    if (snapshotName) {
      expect(this.result.stdout).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.stdout).toMatchSnapshot()
    }
    return this
  }

  /**
   * Assert stderr matches snapshot.
   */
  stderrMatchesSnapshot(snapshotName?: string | undefined): this {
    if (snapshotName) {
      expect(this.result.stderr).toMatchSnapshot(snapshotName)
    } else {
      expect(this.result.stderr).toMatchSnapshot()
    }
    return this
  }

  /**
   * Get the raw result for custom assertions.
   */
  get raw(): CliExecutionResult {
    return this.result
  }
}

/**
 * Create fluent assertion builder for CLI output validation.
 *
 * @example
 *   ;```typescript
 *   const result = await executeCliCommand(['scan', '--help'])
 *   expectOutput(result)
 *     .succeeded()
 *     .stdoutContains('Usage')
 *     .stdoutContains('Options')
 *     .stderrEmpty()
 *   ```
 *
 * @param result - CLI execution result.
 *
 * @returns Fluent assertion builder
 */
export function expectOutput(result: CliExecutionResult): OutputAssertion {
  return new OutputAssertion(result)
}
