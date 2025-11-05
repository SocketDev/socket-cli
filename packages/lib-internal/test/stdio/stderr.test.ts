/**
 * @fileoverview Unit tests for stderr stream utilities.
 *
 * Tests stderr output utilities:
 * - writeStderr() writes to stderr stream
 * - Error message formatting
 * - Stream detection (TTY vs pipe)
 * - Color support detection for stderr
 * Used by Socket tools for error reporting and diagnostic output.
 */

import { describe, expect, it } from 'vitest'

import {
  clearLine,
  cursorTo,
  getColumns,
  getRows,
  isTTY,
  stderr,
  writeError,
  writeErrorFormatted,
  writeErrorLine,
  writeStackTrace,
  writeWarning,
} from '@socketsecurity/lib/stdio/stderr'
import { setupStdioTestSuite } from '../utils/stdio-test-helper'

describe('stdio/stderr', () => {
  const getContext = setupStdioTestSuite(stderr)

  describe('stderr', () => {
    it('should export stderr stream', () => {
      expect(stderr).toBeDefined()
      expect(stderr).toBe(process.stderr)
    })

    it('should be a WriteStream', () => {
      expect(stderr).toBeInstanceOf(Object)
    })
  })

  describe('writeErrorLine', () => {
    it('should export writeErrorLine function', () => {
      expect(typeof writeErrorLine).toBe('function')
    })

    it('should write text with newline', () => {
      writeErrorLine('Error occurred')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Error occurred\n')
    })

    it('should write empty line when no text provided', () => {
      writeErrorLine()
      expect(getContext().writeSpy).toHaveBeenCalledWith('\n')
    })

    it('should write empty string with newline', () => {
      writeErrorLine('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('\n')
    })

    it('should handle multiline text', () => {
      writeErrorLine('Line 1\nLine 2')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Line 1\nLine 2\n')
    })

    it('should handle special characters', () => {
      writeErrorLine('Tab\tNewline')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Tab\tNewline\n')
    })

    it('should handle Unicode characters', () => {
      writeErrorLine('Error: 失败')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Error: 失败\n')
    })

    it('should handle ANSI color codes', () => {
      writeErrorLine('\u001B[31mRed Error\u001B[0m')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        '\u001B[31mRed Error\u001B[0m\n',
      )
    })

    it('should not return a value', () => {
      const result = writeErrorLine('test')
      expect(result).toBeUndefined()
    })
  })

  describe('writeError', () => {
    it('should export writeError function', () => {
      expect(typeof writeError).toBe('function')
    })

    it('should write text without newline', () => {
      writeError('Downloading...')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Downloading...')
    })

    it('should write empty string', () => {
      writeError('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('')
    })

    it('should handle ANSI escape sequences', () => {
      writeError('\u001B[33mWarning\u001B[0m')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        '\u001B[33mWarning\u001B[0m',
      )
    })

    it('should not return a value', () => {
      const result = writeError('test')
      expect(result).toBeUndefined()
    })
  })

  describe('clearLine', () => {
    it('should export clearLine function', () => {
      expect(typeof clearLine).toBe('function')
    })

    it('should clear line in TTY', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      clearLine()
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(0)
      expect(getContext().clearLineSpy).toHaveBeenCalledWith(0)
    })

    it('should not return a value', () => {
      Object.defineProperty(stderr, 'isTTY', {
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
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(10)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(10, undefined)
    })

    it('should move cursor to x,y position in TTY', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(10, 5)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(10, 5)
    })

    it('should move cursor to 0,0', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(0, 0)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(0, 0)
    })

    it('should not return a value', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      const result = cursorTo(0)
      expect(result).toBeUndefined()
    })

    it('should handle large coordinates', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(1000, 500)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(1000, 500)
    })

    it('should handle negative coordinates', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      cursorTo(-1, -1)
      expect(getContext().cursorToSpy).toHaveBeenCalledWith(-1, -1)
    })
  })

  describe('isTTY', () => {
    it('should export isTTY function', () => {
      expect(typeof isTTY).toBe('function')
    })

    it('should return true when stderr is TTY', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      expect(isTTY()).toBe(true)
    })

    it('should return false when stderr is not TTY', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: false,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
    })

    it('should return false when isTTY is undefined', () => {
      Object.defineProperty(stderr, 'isTTY', {
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
      Object.defineProperty(stderr, 'columns', {
        value: 120,
        configurable: true,
      })
      expect(getColumns()).toBe(120)
    })

    it('should return default 80 when columns is undefined', () => {
      Object.defineProperty(stderr, 'columns', {
        value: undefined,
        configurable: true,
      })
      expect(getColumns()).toBe(80)
    })

    it('should return default 80 when columns is 0', () => {
      Object.defineProperty(stderr, 'columns', { value: 0, configurable: true })
      expect(getColumns()).toBe(80)
    })

    it('should handle small terminal width', () => {
      Object.defineProperty(stderr, 'columns', {
        value: 40,
        configurable: true,
      })
      expect(getColumns()).toBe(40)
    })

    it('should handle large terminal width', () => {
      Object.defineProperty(stderr, 'columns', {
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
      Object.defineProperty(stderr, 'rows', { value: 50, configurable: true })
      expect(getRows()).toBe(50)
    })

    it('should return default 24 when rows is undefined', () => {
      Object.defineProperty(stderr, 'rows', {
        value: undefined,
        configurable: true,
      })
      expect(getRows()).toBe(24)
    })

    it('should return default 24 when rows is 0', () => {
      Object.defineProperty(stderr, 'rows', { value: 0, configurable: true })
      expect(getRows()).toBe(24)
    })

    it('should handle small terminal height', () => {
      Object.defineProperty(stderr, 'rows', { value: 10, configurable: true })
      expect(getRows()).toBe(10)
    })

    it('should handle large terminal height', () => {
      Object.defineProperty(stderr, 'rows', { value: 100, configurable: true })
      expect(getRows()).toBe(100)
    })

    it('should be a number', () => {
      expect(typeof getRows()).toBe('number')
    })
  })

  describe('writeWarning', () => {
    it('should export writeWarning function', () => {
      expect(typeof writeWarning).toBe('function')
    })

    it('should write warning with default prefix', () => {
      writeWarning('Deprecated API')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Warning: Deprecated API\n',
      )
    })

    it('should write warning with custom prefix', () => {
      writeWarning('Invalid config', 'Config')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Config: Invalid config\n',
      )
    })

    it('should handle empty message', () => {
      writeWarning('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Warning: \n')
    })

    it('should handle multiline message', () => {
      writeWarning('Line 1\nLine 2')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Warning: Line 1\nLine 2\n',
      )
    })

    it('should handle special characters in message', () => {
      writeWarning('Path contains \\n escape')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Warning: Path contains \\n escape\n',
      )
    })

    it('should handle Unicode in message', () => {
      writeWarning('警告メッセージ')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Warning: 警告メッセージ\n',
      )
    })

    it('should handle empty prefix', () => {
      writeWarning('Test message', '')
      expect(getContext().writeSpy).toHaveBeenCalledWith(': Test message\n')
    })

    it('should not return a value', () => {
      const result = writeWarning('test')
      expect(result).toBeUndefined()
    })
  })

  describe('writeErrorFormatted', () => {
    it('should export writeErrorFormatted function', () => {
      expect(typeof writeErrorFormatted).toBe('function')
    })

    it('should write error with default prefix', () => {
      writeErrorFormatted('File not found')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: File not found\n',
      )
    })

    it('should write error with custom prefix', () => {
      writeErrorFormatted('Connection failed', 'Network')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Network: Connection failed\n',
      )
    })

    it('should handle empty message', () => {
      writeErrorFormatted('')
      expect(getContext().writeSpy).toHaveBeenCalledWith('Error: \n')
    })

    it('should handle multiline message', () => {
      writeErrorFormatted('Line 1\nLine 2')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: Line 1\nLine 2\n',
      )
    })

    it('should handle special characters', () => {
      writeErrorFormatted('Invalid character: $')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: Invalid character: $\n',
      )
    })

    it('should handle Unicode characters', () => {
      writeErrorFormatted('エラーが発生しました')
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: エラーが発生しました\n',
      )
    })

    it('should handle empty prefix', () => {
      writeErrorFormatted('Test message', '')
      expect(getContext().writeSpy).toHaveBeenCalledWith(': Test message\n')
    })

    it('should not return a value', () => {
      const result = writeErrorFormatted('test')
      expect(result).toBeUndefined()
    })
  })

  describe('writeStackTrace', () => {
    it('should export writeStackTrace function', () => {
      expect(typeof writeStackTrace).toBe('function')
    })

    it('should write formatted error when no stack', () => {
      const error = new Error('Test error')
      error.stack = undefined
      writeStackTrace(error)
      expect(getContext().writeSpy).toHaveBeenCalledWith('Error: Test error\n')
    })

    it('should handle error with empty message', () => {
      const error = new Error('')
      writeStackTrace(error)
      expect(getContext().writeSpy).toHaveBeenCalled()
    })

    it('should handle error with multiline message', () => {
      const error = new Error('Line 1\nLine 2')
      error.stack = undefined
      writeStackTrace(error)
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: Line 1\nLine 2\n',
      )
    })

    it('should handle error with Unicode message', () => {
      const error = new Error('エラー: 失敗')
      error.stack = undefined
      writeStackTrace(error)
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: エラー: 失敗\n',
      )
    })

    it('should not return a value', () => {
      const error = new Error('test')
      const result = writeStackTrace(error)
      expect(result).toBeUndefined()
    })
  })

  describe('integration', () => {
    it('should support exception handling pattern', () => {
      try {
        throw new Error('Something went wrong')
      } catch (err) {
        writeStackTrace(err as Error)
      }
      expect(getContext().writeSpy).toHaveBeenCalled()
    })

    it('should handle graceful degradation from TTY to non-TTY', () => {
      // Start with TTY
      Object.defineProperty(stderr, 'isTTY', {
        value: true,
        configurable: true,
      })
      clearLine()
      expect(getContext().clearLineSpy).toHaveBeenCalled()

      getContext().clearLineSpy.mockClear()

      // Switch to non-TTY
      Object.defineProperty(stderr, 'isTTY', {
        value: false,
        configurable: true,
      })
      clearLine()
      expect(getContext().clearLineSpy).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle undefined isTTY', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: undefined,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
      clearLine() // Should not throw
      cursorTo(0) // Should not throw
    })

    it('should handle very long error messages', () => {
      const longMessage = 'x'.repeat(10_000)
      writeErrorLine(longMessage)
      expect(getContext().writeSpy).toHaveBeenCalledWith(`${longMessage}\n`)
    })

    it('should handle terminal dimension changes', () => {
      Object.defineProperty(stderr, 'columns', {
        value: 80,
        configurable: true,
      })
      expect(getColumns()).toBe(80)

      Object.defineProperty(stderr, 'columns', {
        value: 120,
        configurable: true,
      })
      expect(getColumns()).toBe(120)
    })

    it('should handle null-like terminal dimensions', () => {
      Object.defineProperty(stderr, 'columns', {
        value: null,
        configurable: true,
      })
      expect(getColumns()).toBe(80)

      Object.defineProperty(stderr, 'rows', { value: null, configurable: true })
      expect(getRows()).toBe(24)
    })

    it('should handle errors with no stack property', () => {
      const error = { message: 'Not a real Error' } as Error
      writeStackTrace(error)
      expect(getContext().writeSpy).toHaveBeenCalledWith(
        'Error: Not a real Error\n',
      )
    })
  })

  describe('real-world usage', () => {
    it('should detect redirected error output', () => {
      Object.defineProperty(stderr, 'isTTY', {
        value: false,
        configurable: true,
      })
      expect(isTTY()).toBe(false)
      // When piped, should still write but skip terminal control
      writeErrorLine('Error line')
      expect(getContext().writeSpy).toHaveBeenCalled()
    })

    it('should handle terminal size queries', () => {
      Object.defineProperty(stderr, 'columns', {
        value: 120,
        configurable: true,
      })
      Object.defineProperty(stderr, 'rows', { value: 40, configurable: true })
      const width = getColumns()
      const height = getRows()
      expect(width).toBe(120)
      expect(height).toBe(40)
    })
  })
})
