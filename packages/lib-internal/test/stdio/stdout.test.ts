/**
 * @fileoverview Unit tests for stdout stream utilities.
 *
 * Tests stdout output utilities:
 * - writeStdout() writes to stdout stream
 * - Output formatting and buffering
 * - Stream detection (TTY vs pipe)
 * - Color support detection for stdout
 * Used by Socket tools for standard output and interactive CLI features.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  clearLine,
  clearScreenDown,
  cursorTo,
  ensureCursorOnExit,
  getColumns,
  getRows,
  hideCursor,
  isTTY,
  showCursor,
  stdout,
  write,
  writeLine,
} from '@socketsecurity/lib/stdio/stdout'
import { setupStdioTestSuite } from '../utils/stdio-test-helper'

describe('stdio/stdout', () => {
  const getContext = setupStdioTestSuite(stdout)

  describe('stdout', () => {
    it('should export stdout stream', () => {
      expect(stdout).toBeDefined()
      expect(stdout).toBe(process.stdout)
    })

    it('should be a WriteStream', () => {
      expect(stdout).toBeInstanceOf(Object)
    })
  })

  describe('writeLine', () => {
    it('should export writeLine function', () => {
      expect(typeof writeLine).toBe('function')
    })

    it('should write text with newline', () => {
      writeLine('Hello, world!')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Hello, world!\n')
    })

    it('should write empty line when no text provided', () => {
      writeLine()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\n')
    })

    it('should write empty string with newline', () => {
      writeLine('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('\n')
    })

    it('should handle multiline text', () => {
      writeLine('Line 1\nLine 2')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Line 1\nLine 2\n')
    })

    it('should handle special characters', () => {
      writeLine('Tab\tNewline')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Tab\tNewline\n')
    })

    it('should handle Unicode characters', () => {
      writeLine('Hello 世界')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Hello 世界\n')
    })

    it('should handle emojis', () => {
      writeLine('Success! ✅')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Success! ✅\n')
    })

    it('should not return a value', () => {
      const result = writeLine('test')
      expect(result).toBeUndefined()
    })
  })

  describe('write', () => {
    it('should export write function', () => {
      expect(typeof write).toBe('function')
    })

    it('should write text without newline', () => {
      write('Loading...')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Loading...')
    })

    it('should write empty string', () => {
      write('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('')
    })

    it('should handle ANSI escape sequences', () => {
      write('\u001B[32mGreen\u001B[0m')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        '\u001B[32mGreen\u001B[0m',
      )
    })

    it('should not return a value', () => {
      const result = write('test')
      expect(result).toBeUndefined()
    })
  })

  describe('clearLine', () => {
    it('should export clearLine function', () => {
      expect(typeof clearLine).toBe('function')
    })

    it('should clear line in TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      clearLine()
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(0)
      expect(getContext().clearLineSpy).toHaveBeenCalledWith(0)
    })

    it('should not return a value', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = clearLine()
      expect(result).toBeUndefined()
    })
  })

  describe('cursorTo', () => {
    it('should export cursorTo function', () => {
      expect(typeof cursorTo).toBe('function')
    })

    it('should move cursor to x position in TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(10)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(10, undefined)
    })

    it('should move cursor to x,y position in TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(10, 5)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(10, 5)
    })

    it('should move cursor to 0,0', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(0, 0)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(0, 0)
    })

    it('should not return a value', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = cursorTo(0)
      expect(result).toBeUndefined()
    })

    it('should handle large coordinates', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(1000, 500)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(1000, 500)
    })

    it('should handle negative coordinates', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(-1, -1)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(-1, -1)
    })
  })

  describe('clearScreenDown', () => {
    it('should export clearScreenDown function', () => {
      expect(typeof clearScreenDown).toBe('function')
    })

    it('should clear screen down in TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      clearScreenDown()
      expect(getContext().clearScreenDownSpy).toHaveBeenCalled()
    })

    it('should not return a value', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = clearScreenDown()
      expect(result).toBeUndefined()
    })
  })

  describe('isTTY', () => {
    it('should export isTTY function', () => {
      expect(typeof isTTY).toBe('function')
    })

    it('should return true when stdout is TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      expect(isTTY()).toBe(true)
    })

    it('should return false when stdout is not TTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: false,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
    })

    it('should return false when isTTY is undefined', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: undefined,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
    })

    it('should be a boolean', () => {
      expect(typeof isTTY()).toBe('boolean')
    })
  })

  describe('getColumns', () => {
    it('should export getColumns function', () => {
      expect(typeof getColumns).toBe('function')
    })

    it('should return actual columns when set', () => {
      Object.defineProperty(stdout, 'columns', {
        value: 120,
        configurable: true,
      })
      expect(getColumns()).toBe(120)
    })

    it('should return default 80 when columns is undefined', () => {
      Object.defineProperty(stdout, 'columns', {
        value: undefined,
        configurable: true,
      })
      expect(getColumns()).toBe(80)
    })

    it('should return default 80 when columns is 0', () => {
      Object.defineProperty(stdout, 'columns', { value: 0, configurable: true })
      expect(getColumns()).toBe(80)
    })

    it('should handle small terminal width', () => {
      Object.defineProperty(stdout, 'columns', {
        value: 40,
        configurable: true,
      })
      expect(getColumns()).toBe(40)
    })

    it('should handle large terminal width', () => {
      Object.defineProperty(stdout, 'columns', {
        value: 300,
        configurable: true,
      })
      expect(getColumns()).toBe(300)
    })

    it('should be a number', () => {
      expect(typeof getColumns()).toBe('number')
    })
  })

  describe('getRows', () => {
    it('should export getRows function', () => {
      expect(typeof getRows).toBe('function')
    })

    it('should return actual rows when set', () => {
      Object.defineProperty(stdout, 'rows', { value: 50, configurable: true })
      expect(getRows()).toBe(50)
    })

    it('should return default 24 when rows is undefined', () => {
      Object.defineProperty(stdout, 'rows', {
        value: undefined,
        configurable: true,
      })
      expect(getRows()).toBe(24)
    })

    it('should return default 24 when rows is 0', () => {
      Object.defineProperty(stdout, 'rows', { value: 0, configurable: true })
      expect(getRows()).toBe(24)
    })

    it('should handle small terminal height', () => {
      Object.defineProperty(stdout, 'rows', { value: 10, configurable: true })
      expect(getRows()).toBe(10)
    })

    it('should handle large terminal height', () => {
      Object.defineProperty(stdout, 'rows', { value: 100, configurable: true })
      expect(getRows()).toBe(100)
    })

    it('should be a number', () => {
      expect(typeof getRows()).toBe('number')
    })
  })

  describe('hideCursor', () => {
    it('should export hideCursor function', () => {
      expect(typeof hideCursor).toBe('function')
    })

    it('should write hide cursor sequence in TTY WriteStream', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      hideCursor()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25l')
    })

    it('should not return a value', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = hideCursor()
      expect(result).toBeUndefined()
    })
  })

  describe('showCursor', () => {
    it('should export showCursor function', () => {
      expect(typeof showCursor).toBe('function')
    })

    it('should write show cursor sequence in TTY WriteStream', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      showCursor()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25h')
    })

    it('should not return a value', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = showCursor()
      expect(result).toBeUndefined()
    })
  })

  describe('ensureCursorOnExit', () => {
    it('should export ensureCursorOnExit function', () => {
      expect(typeof ensureCursorOnExit).toBe('function')
    })

    it('should register exit handler', () => {
      const processOnSpy = vi.spyOn(process, 'on')
      ensureCursorOnExit()
      expect(processOnSpy).toHaveBeenCalledWith('exit', expect.any(Function))
      processOnSpy.mockRestore()
    })

    it('should register SIGINT handler', () => {
      const processOnSpy = vi.spyOn(process, 'on')
      ensureCursorOnExit()
      expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      processOnSpy.mockRestore()
    })

    it('should register SIGTERM handler', () => {
      const processOnSpy = vi.spyOn(process, 'on')
      ensureCursorOnExit()
      expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
      processOnSpy.mockRestore()
    })

    it('should not return a value', () => {
      const result = ensureCursorOnExit()
      expect(result).toBeUndefined()
    })
  })

  describe('integration', () => {
    it('should support write and writeLine together', () => {
      write('Loading')
      write('...')
      writeLine(' Done!')
      expect(getContext().writeSpy).toHaveBeenCalledTimes(3)
      expect(getContext().writeSpy).toHaveBeenNthCalledWith(1, 'Loading')
      expect(getContext().writeSpy).toHaveBeenNthCalledWith(2, '...')
      expect(getContext().writeSpy).toHaveBeenNthCalledWith(3, ' Done!\n')
    })

    it('should support hide/show cursor pattern', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      hideCursor()
      write('Animation frame 1')
      write('Animation frame 2')
      showCursor()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25l')
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25h')
    })

    it('should handle graceful degradation from TTY to non-TTY', () => {
      // Start with TTY
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      clearLine()
      expect(getContext().clearLineSpy).toHaveBeenCalled()

      getContext().clearLineSpy.mockClear()

      // Switch to non-TTY
      Object.defineProperty(stdout, 'isTTY', {
        value: false,
        configurable: true,
      })
      clearLine()
      expect(getContext().clearLineSpy).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined isTTY', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: undefined,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
      clearLine() // Should not throw
      cursorTo(0) // Should not throw
      clearScreenDown() // Should not throw
      hideCursor() // Should not throw
      showCursor() // Should not throw
    })

    it('should handle very long text', () => {
      const longText = 'x'.repeat(10_000)
      writeLine(longText)
      expect(getContext().writeSpy).toHaveBeenCalledWith(`${longText}\n`)
    })

    it('should handle rapid cursor movements', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      // Clear spy calls from any previous tests to ensure accurate count
      getContext().cursorToSpy.mockClear()
      const callsBefore = getContext().cursorToSpy.mock.calls.length
      for (let i = 0; i < 100; i++) {
        cursorTo(i, i)
      }
      const callsAfter = getContext().cursorToSpy.mock.calls.length
      expect(callsAfter - callsBefore).toBe(100)
    })

    it('should handle terminal dimension changes', () => {
      Object.defineProperty(stdout, 'columns', {
        value: 80,
        configurable: true,
      })
      expect(getColumns()).toBe(80)

      Object.defineProperty(stdout, 'columns', {
        value: 120,
        configurable: true,
      })
      expect(getColumns()).toBe(120)
    })

    it('should handle null-like terminal dimensions', () => {
      Object.defineProperty(stdout, 'columns', {
        value: null,
        configurable: true,
      })
      expect(getColumns()).toBe(80)

      Object.defineProperty(stdout, 'rows', { value: null, configurable: true })
      expect(getRows()).toBe(24)
    })
  })

  describe('real-world usage', () => {
    it('should support progress indicator pattern', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      // Clear spy to ensure this test runs in isolation
      getContext().writeSpy.mockClear()
      write('Loading...')
      clearLine()
      write('Loading... 50%')
      clearLine()
      write('Loading... 100%')
      writeLine(' Done!')
      // Actual calls: 3 writes + 1 writeLine = 4 calls (clearLine calls cursorTo and clearLine internally but not write)
      expect(getContext().writeSpy).toHaveBeenCalledTimes(4)
    })

    it('should support spinner pattern', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: true,
        configurable: true,
      })
      hideCursor()
      const frames = ['⠋', '⠙', '⠹', '⠸']
      for (const frame of frames) {
        write(frame)
        clearLine()
      }
      showCursor()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25l')
      expect(getContext().writeSpy).toHaveBeenCalledWith('\u001B[?25h')
    })

    it('should support table rendering', () => {
      // Clear spy to ensure this test runs in isolation
      getContext().writeSpy.mockClear()
      writeLine('Name        | Age | City')
      writeLine('------------|-----|-------')
      writeLine('John Doe    | 30  | NYC')
      writeLine('Jane Smith  | 25  | LA')
      expect(getContext().writeSpy).toHaveBeenCalledTimes(4)
    })

    it('should detect redirected output', () => {
      Object.defineProperty(stdout, 'isTTY', {
        value: false,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
      // When piped, should still write but skip terminal control
      writeLine('Output line')
      expect(getContext().writeSpy).toHaveBeenCalled()
    })

    it('should handle terminal size queries', () => {
      Object.defineProperty(stdout, 'columns', {
        value: 120,
        configurable: true,
      })
      Object.defineProperty(stdout, 'rows', { value: 40, configurable: true })
      const width = getColumns()
      const height = getRows()
      expect(width).toBe(120)
      expect(height).toBe(40)
    })
  })
})
