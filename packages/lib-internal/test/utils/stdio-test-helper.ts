/**
 * @fileoverview Shared test utilities for stdio stream testing.
 */

import { WriteStream } from 'node:tty'
import type { Writable } from 'node:stream'
import { afterEach, beforeEach, vi } from 'vitest'

interface StdioTestContext {
  originalIsTTY: boolean | undefined
  originalColumns: number | undefined
  originalRows: number | undefined
  writeSpy: ReturnType<typeof vi.spyOn>
  cursorToSpy?: ReturnType<typeof vi.spyOn>
  clearLineSpy?: ReturnType<typeof vi.spyOn>
  clearScreenDownSpy?: ReturnType<typeof vi.spyOn>
}

/**
 * Sets up common mocks and spies for stdio stream testing.
 * Reduces ~50 lines of duplicate setup code per test file.
 */
export function setupStdioTest(
  stream: NodeJS.WriteStream & Writable,
): StdioTestContext {
  const context: StdioTestContext = {
    originalIsTTY: stream.isTTY,
    originalColumns: stream.columns,
    originalRows: stream.rows,
    writeSpy: vi.spyOn(stream, 'write').mockImplementation(() => true) as any,
  }

  // Make stream appear as a WriteStream instance for hide/showCursor tests
  Object.setPrototypeOf(stream, WriteStream.prototype)

  // Create stubs for TTY methods only if they don't exist, then spy on them
  if (!stream.cursorTo) {
    ;(stream as any).cursorTo = vi.fn()
  }
  context.cursorToSpy = vi
    .spyOn(stream, 'cursorTo' as any)
    .mockImplementation(() => {}) as any

  if (!stream.clearLine) {
    ;(stream as any).clearLine = vi.fn()
  }
  context.clearLineSpy = vi
    .spyOn(stream, 'clearLine' as any)
    .mockImplementation(() => {}) as any

  if (!stream.clearScreenDown) {
    ;(stream as any).clearScreenDown = vi.fn()
  }
  context.clearScreenDownSpy = vi
    .spyOn(stream, 'clearScreenDown' as any)
    .mockImplementation(() => {}) as any

  return context
}

/**
 * Tears down mocks and restores original properties.
 * Reduces ~20 lines of duplicate teardown code per test file.
 */
export function teardownStdioTest(
  stream: NodeJS.WriteStream & Writable,
  context: StdioTestContext,
): void {
  // Clear call history before restoring
  context.writeSpy?.mockClear()
  context.cursorToSpy?.mockClear()
  context.clearLineSpy?.mockClear()
  context.clearScreenDownSpy?.mockClear()

  // Restore spies
  context.writeSpy?.mockRestore()
  context.cursorToSpy?.mockRestore()
  context.clearLineSpy?.mockRestore()
  context.clearScreenDownSpy?.mockRestore()

  // Restore original properties
  Object.defineProperty(stream, 'isTTY', {
    value: context.originalIsTTY,
    configurable: true,
  })
  Object.defineProperty(stream, 'columns', {
    value: context.originalColumns,
    configurable: true,
  })
  Object.defineProperty(stream, 'rows', {
    value: context.originalRows,
    configurable: true,
  })
}

/**
 * Returns a beforeEach/afterEach setup for stdio stream testing.
 * Use this to eliminate repetitive setup code entirely.
 */
export function setupStdioTestSuite(stream: NodeJS.WriteStream & Writable) {
  let context: StdioTestContext

  beforeEach(() => {
    context = setupStdioTest(stream)
    // Clear call history to ensure tests start with clean slate
    context.writeSpy.mockClear()
    context.cursorToSpy?.mockClear()
    context.clearLineSpy?.mockClear()
    context.clearScreenDownSpy?.mockClear()
  })

  afterEach(() => {
    teardownStdioTest(stream, context)
  })

  return () => context
}
