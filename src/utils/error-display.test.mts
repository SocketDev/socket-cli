/** @fileoverview Tests for error display utilities. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatErrorCompact,
  formatErrorForDisplay,
  formatErrorForJson,
  formatErrorForTerminal,
  formatExternalCliError,
  formatInfo,
  formatSuccess,
  formatWarning,
} from './error-display.mts'
import { AuthError, InputError } from './errors.mts'

// Mock debug utilities
vi.mock('./debug.mts', () => ({
  debugFn: vi.fn(),
  isDebug: vi.fn(() => false),
}))

describe('error display utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('formatErrorForDisplay', () => {
    it('should format AuthError', () => {
      const error = new AuthError('Invalid API token')
      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Authentication error')
      expect(result.message).toBe('Invalid API token')
    })

    it('should format InputError', () => {
      const error = new InputError('Missing required field')
      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Invalid input')
      expect(result.message).toBe('Missing required field')
    })

    it('should format InputError with body', () => {
      const error = new InputError('Invalid config')
      error.body = 'Config file is malformed'
      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Invalid input')
      expect(result.message).toBe('Invalid config')
      expect(result.body).toBe('Config file is malformed')
    })

    it('should format generic Error', () => {
      const error = new Error('Something went wrong')
      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Unexpected error')
      expect(result.message).toBe('Something went wrong')
    })

    it('should include stack trace when showStack is true', () => {
      const error = new Error('Test error')
      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toBeDefined()
    })

    it('should handle error with cause', () => {
      const cause = new Error('Root cause')
      const error = new Error('Main error', { cause })
      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toContain('Caused by')
    })

    it('should handle nested error causes', () => {
      const rootCause = new Error('Root')
      const midCause = new Error('Middle', { cause: rootCause })
      const error = new Error('Top', { cause: midCause })
      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toContain('Caused by [1]')
      expect(result.body).toContain('Caused by [2]')
    })

    it('should limit cause depth to 5', () => {
      let cause: Error | undefined = new Error('Level 6')
      for (let i = 5; i > 0; i--) {
        cause = new Error(`Level ${i}`, { cause })
      }
      const error = new Error('Top', { cause })
      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).not.toContain('Level 6')
    })

    it('should format string errors', () => {
      const result = formatErrorForDisplay('Simple error message')

      expect(result.title).toBe('Error')
      expect(result.message).toBe('Simple error message')
    })

    it('should format unknown error types', () => {
      const result = formatErrorForDisplay({ weird: 'object' })

      expect(result.title).toBe('Unexpected error')
      expect(result.message).toBe('An unknown error occurred')
    })

    it('should include unknown error in body when verbose', () => {
      const result = formatErrorForDisplay(
        { weird: 'object' },
        { verbose: true },
      )

      expect(result.body).toBeDefined()
    })

    it('should use custom title', () => {
      const error = new Error('Test')
      const result = formatErrorForDisplay(error, { title: 'Custom Title' })

      expect(result.title).toBe('Custom Title')
    })

    it('should add cause from options', () => {
      const error = new Error('Test')
      const result = formatErrorForDisplay(error, { cause: 'Extra context' })

      expect(result.body).toBe('Extra context')
    })

    it('should handle non-Error cause types', () => {
      const error = new Error('Test')
      // @ts-expect-error - Testing runtime behavior
      error.cause = 'string cause'
      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toContain('string cause')
    })
  })

  describe('formatErrorCompact', () => {
    it('should format Error instances', () => {
      const error = new Error('Test error')
      const result = formatErrorCompact(error)

      expect(result).toBe('Test error')
    })

    it('should format string errors', () => {
      const result = formatErrorCompact('Simple error')

      expect(result).toBe('Simple error')
    })

    it('should format unknown types', () => {
      const result = formatErrorCompact({ weird: 'object' })

      expect(result).toBe('An unknown error occurred')
    })
  })

  describe('formatErrorForTerminal', () => {
    it('should format basic error', () => {
      const error = new Error('Test error')
      const result = formatErrorForTerminal(error)

      expect(result).toContain('Test error')
    })

    it('should include stack trace in verbose mode', () => {
      const error = new Error('Test error')
      const result = formatErrorForTerminal(error, { verbose: true })

      expect(result).toContain('Stack trace')
    })

    it('should show debug hint when not verbose', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n  at test'
      const result = formatErrorForTerminal(error, {
        verbose: false,
        showStack: true,
      })

      expect(result).toContain('Run with DEBUG=1')
    })

    it('should handle error without message', () => {
      const error = new Error()
      const result = formatErrorForTerminal(error)

      expect(typeof result).toBe('string')
    })
  })

  describe('formatErrorForJson', () => {
    it('should format error as JSON result', () => {
      const error = new Error('Test error')
      const result = formatErrorForJson(error)

      expect(result.ok).toBe(false)
      expect(result.message).toBe('Unexpected error')
    })

    it('should strip ANSI codes', () => {
      const error = new Error('Test error')
      const result = formatErrorForJson(error)

      expect(result.message).not.toContain('\x1b')
    })

    it('should not include stack trace', () => {
      const error = new Error('Test error')
      const result = formatErrorForJson(error)

      // Stack trace should not be in the output
      expect(result.cause).not.toContain('at ')
    })
  })

  describe('formatExternalCliError', () => {
    it('should format command failure', () => {
      const error = new Error('Command failed')
      const result = formatExternalCliError('npm install', error)

      expect(result).toContain('Command failed: npm install')
      expect(result).toContain('Command failed')
    })

    it('should include exit code', () => {
      const error = { code: 1, message: 'Failed' }
      const result = formatExternalCliError('test command', error)

      expect(result).toContain('Exit code')
      expect(result).toContain('1')
    })

    it('should include stderr', () => {
      const error = { stderr: 'Error: something went wrong\nLine 2' }
      const result = formatExternalCliError('test command', error)

      expect(result).toContain('Error output')
      expect(result).toContain('something went wrong')
    })

    it('should handle both exit code and stderr', () => {
      const error = { code: 127, stderr: 'command not found' }
      const result = formatExternalCliError('missing-command', error)

      expect(result).toContain('127')
      expect(result).toContain('command not found')
    })

    it('should handle Error instances', () => {
      const error = new Error('Process failed')
      const result = formatExternalCliError('test', error)

      expect(result).toContain('Process failed')
    })

    it('should call debugFn in verbose mode', async () => {
      const { isDebug } = vi.mocked(await import('./debug.mts'))
      isDebug.mockReturnValue(true)

      const error = new Error('Test')
      formatExternalCliError('test', error, { verbose: true })

      const { debugFn } = vi.mocked(await import('./debug.mts'))
      expect(debugFn).toHaveBeenCalled()
    })
  })

  describe('formatWarning', () => {
    it('should format warning without details', () => {
      const result = formatWarning('This is a warning')

      expect(result).toContain('This is a warning')
    })

    it('should format warning with details', () => {
      const result = formatWarning('Warning message', 'Additional context')

      expect(result).toContain('Warning message')
      expect(result).toContain('Additional context')
    })
  })

  describe('formatSuccess', () => {
    it('should format success without details', () => {
      const result = formatSuccess('Operation successful')

      expect(result).toContain('Operation successful')
    })

    it('should format success with details', () => {
      const result = formatSuccess('Success', 'All checks passed')

      expect(result).toContain('Success')
      expect(result).toContain('All checks passed')
    })
  })

  describe('formatInfo', () => {
    it('should format info without details', () => {
      const result = formatInfo('Information message')

      expect(result).toContain('Information message')
    })

    it('should format info with details', () => {
      const result = formatInfo('Info', 'More information here')

      expect(result).toContain('Info')
      expect(result).toContain('More information here')
    })
  })
})
