/**
 * @file Standalone output assertion helpers for Socket CLI tests. Validates
 *   CLI output shape, error messages, and exit codes. The fluent
 *   `OutputAssertion` builder lives in `./output-assertion-builder.mts`.
 */

import { expect } from 'vitest'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import type { CliExecutionResult } from './cli-execution.mts'

/**
 * Validate dry-run test output to prevent flipped snapshots. Under the CLI's
 * stream discipline (stdout carries only the payload; status output routes to
 * stderr) the "[DryRun]:" marker is emitted on STDERR, at column 0 after the
 * banner. Dry-run tests pass `stderr` here and this guard requires a line
 * starting with "[DryRun]:". If the snapshot gets flipped (expected=""
 * received="[DryRun]:..."), this will catch it.
 *
 * @param output - CLI stderr output string.
 * @param snapshotValue - The value from toMatchInlineSnapshot.
 *
 * @throws Error if snapshot appears to be flipped
 */
export function expectDryRunOutput(
  output: string,
  snapshotValue?: string | undefined,
): void {
  // Output should always contain a line starting with [DryRun]: for dry-run
  // tests (the banner precedes it on stderr, so not startsWith on the blob).
  const hasDryRunLine = /^\[DryRun\]:/m.test(output)

  if (!hasDryRunLine) {
    throw new Error(
      `Expected dry-run output to contain a line starting with "[DryRun]:" but got: ${output.slice(0, 100)}`,
    )
  }

  // If snapshot value is provided, validate it's not flipped.
  if (snapshotValue !== undefined) {
    // Snapshot should not be empty if output has [DryRun]:
    if (snapshotValue === '' || snapshotValue === '""') {
      throw new Error(
        'FLIPPED SNAPSHOT DETECTED!\n\n' +
          `The snapshot is empty but the actual output starts with "[DryRun]:".\n` +
          'This means the expected/received values are flipped.\n\n' +
          `Actual output: ${output}\n` +
          `Snapshot value: ${snapshotValue}\n\n` +
          'FIX: Update the snapshot to expect the [DryRun]: output, not an empty string.\n' +
          'Run: pnpm testu <test-file> to update the snapshot correctly.',
      )
    }

    // Snapshot should carry the [DryRun]: line if output does.
    const snapshotHasDryRunLine =
      /^\[DryRun\]:/m.test(snapshotValue) ||
      snapshotValue.startsWith('"[DryRun]:')

    if (!snapshotHasDryRunLine) {
      throw new Error(
        'FLIPPED SNAPSHOT DETECTED!\n\n' +
          `The snapshot does not start with "[DryRun]:" but the actual output does.\n` +
          'This means the expected/received values are flipped.\n\n' +
          `Actual output: ${output}\n` +
          `Snapshot value: ${snapshotValue}\n\n` +
          'FIX: Update the snapshot to match the actual [DryRun]: output.\n' +
          'Run: pnpm testu <test-file> to update the snapshot correctly.',
      )
    }
  }

  // If we get here, the snapshot looks correct.
  expect(output).toMatch(/^\[DryRun\]:/m)
}

/**
 * Assert exit code is one of the expected codes.
 *
 * @example
 *   ;```typescript
 *   expectExitCodeOneOf(result, [0, 1]) // Success or specific error
 *   ```
 *
 * @param result - CLI execution result.
 * @param expectedCodes - Array of valid exit codes.
 */
export function expectExitCodeOneOf(
  result: CliExecutionResult,
  expectedCodes: number[],
): void {
  expect(expectedCodes).toContain(result.code)
}

/**
 * Assert output matches expected line count.
 *
 * @example
 *   ;```typescript
 *   expectLineCount(result.stdout, 5)
 *   ```
 *
 * @param output - CLI output string.
 * @param expectedLines - Expected number of lines.
 */
export function expectLineCount(output: string, expectedLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBe(expectedLines)
}

/**
 * Assert output has maximum line count.
 *
 * @example
 *   ;```typescript
 *   expectMaxLineCount(result.stdout, 10)
 *   ```
 *
 * @param output - CLI output string.
 * @param maxLines - Maximum number of lines.
 */
export function expectMaxLineCount(output: string, maxLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBeLessThanOrEqual(maxLines)
}

/**
 * Assert output has minimum line count.
 *
 * @example
 *   ;```typescript
 *   expectMinLineCount(result.stdout, 3)
 *   ```
 *
 * @param output - CLI output string.
 * @param minLines - Minimum number of lines.
 */
export function expectMinLineCount(output: string, minLines: number): void {
  const lines = output.split('\n')
  expect(lines.length).toBeGreaterThanOrEqual(minLines)
}

/**
 * Assert output contains no ANSI color codes (is plain text).
 *
 * @example
 *   ;```typescript
 *   expectNoAnsiCodes(result.stdout)
 *   ```
 *
 * @param output - CLI output string.
 */
export function expectNoAnsiCodes(output: string): void {
  const ansiPattern = /\x1B\[\d+m/
  expect(output).not.toMatch(ansiPattern)
}

/**
 * Assert output contains expected patterns in order.
 *
 * @example
 *   ;```typescript
 *   expectOrderedPatterns(result.stdout, [
 *     'Starting scan',
 *     'Analyzing dependencies',
 *     'Scan complete',
 *   ])
 *   ```
 *
 * @param output - CLI output string.
 * @param patterns - Array of strings/regexes that should appear in order.
 */
export function expectOrderedPatterns(
  output: string,
  patterns: Array<RegExp | string>,
): void {
  let lastIndex = -1

  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const pattern = patterns[i]!
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
 * Assert stdout contains all expected strings.
 *
 * @example
 *   ;```typescript
 *   expectStdoutContainsAll(result.stdout, ['scan', 'repository', 'success'])
 *   ```
 *
 * @param output - CLI output string.
 * @param expected - Array of expected strings.
 */
export function expectStdoutContainsAll(
  output: string,
  expected: string[],
): void {
  for (let i = 0, { length } = expected; i < length; i += 1) {
    const text = expected[i]
    expect(output).toContain(text)
  }
}

/**
 * Assert stdout contains at least one of the expected strings.
 *
 * @example
 *   ;```typescript
 *   expectStdoutContainsAny(result.stdout, ['success', 'completed', 'done'])
 *   ```
 *
 * @param output - CLI output string.
 * @param expected - Array of expected strings.
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
 * Assert output contains table-like structure (aligned columns).
 *
 * @example
 *   ;```typescript
 *   expectTableStructure(result.stdout)
 *   ```
 *
 * @param output - CLI output string.
 */
export function expectTableStructure(output: string): void {
  const lines = output.split('\n').filter(line => line.trim())

  expect(lines.length, 'Expected at least 2 lines for table').toBeGreaterThan(1)

  // Check if lines have consistent structure (similar lengths or alignment)
  const lineLengths = lines.map(line => line.length)
  const avgLength =
    lineLengths.reduce((sum, len) => sum + len, 0) / lineLengths.length
  const maxDeviation = avgLength * 0.3 // Allow 30% deviation

  for (let i = 0, { length } = lineLengths; i < length; i += 1) {
    const lineLength = lineLengths[i]!
    expect(Math.abs(lineLength - avgLength)).toBeLessThan(maxDeviation)
  }
}

/**
 * Assert output is valid JSON.
 *
 * @example
 *   ;```typescript
 *   const json = expectValidJson(result.stdout)
 *   expect(json.status).toBe('success')
 *   ```
 *
 * @param output - CLI output string.
 *
 * @returns Parsed JSON object
 */
export function expectValidJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch (e) {
    throw new Error(
      `Expected valid JSON but got parse error: ${errorMessage(e)}\nOutput: ${output}`,
    )
  }
}
