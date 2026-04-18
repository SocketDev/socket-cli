/**
 * Unit tests for error display utilities.
 *
 * Purpose:
 * Tests the error formatting and display utilities.
 *
 * Test Coverage:
 * - formatErrorForDisplay function
 * - formatErrorCompact function
 * - formatErrorForTerminal function
 * - formatErrorForJson function
 * - formatExternalCliError function
 * - formatWarning function
 * - formatSuccess function
 * - formatInfo function
 *
 * Related Files:
 * - src/utils/error/display.mts (implementation)
 */

import { describe, expect, it, vi } from 'vitest'

// Mock debug namespace checks.
vi.mock('../../../../src/utils/debug.mts', () => ({
  debugDirNs: vi.fn(),
  debugNs: vi.fn(),
  isDebugNs: () => false,
}))

import {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError,
} from '../../../../src/utils/error/errors.mts'
import {
  formatErrorCompact,
  formatErrorForDisplay,
  formatErrorForJson,
  formatErrorForTerminal,
  formatExternalCliError,
  formatInfo,
  formatSuccess,
  formatWarning,
} from '../../../../src/utils/error/display.mts'

describe('error/display', () => {
  describe('formatErrorForDisplay', () => {
    it('formats RateLimitError', () => {
      const error = new RateLimitError('Too many requests', 60)

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('API rate limit exceeded')
      expect(result.message).toContain('Too many requests')
      expect(result.message).toContain('retry after 60s')
    })

    it('formats RateLimitError without retry time', () => {
      const error = new RateLimitError('Too many requests')

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('API rate limit exceeded')
      expect(result.message).not.toContain('retry after')
    })

    it('formats AuthError', () => {
      const error = new AuthError('Invalid token')

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Authentication error')
      expect(result.message).toBe('Invalid token')
    })

    it('formats NetworkError', () => {
      const error = new NetworkError('Connection failed', 500)

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Network error')
      expect(result.message).toContain('Connection failed')
      expect(result.message).toContain('HTTP 500')
    })

    it('formats NetworkError without status code', () => {
      const error = new NetworkError('Connection failed')

      const result = formatErrorForDisplay(error)

      expect(result.message).not.toContain('HTTP')
    })

    it('formats FileSystemError', () => {
      const error = new FileSystemError('Permission denied', '/etc/config')

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('File system error')
      expect(result.message).toContain('Permission denied')
      expect(result.message).toContain('/etc/config')
    })

    it('formats FileSystemError without path', () => {
      const error = new FileSystemError('Disk full')

      const result = formatErrorForDisplay(error)

      expect(result.message).toBe('Disk full')
    })

    it('formats ConfigError', () => {
      const error = new ConfigError('Invalid value', 'apiToken')

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Configuration error')
      expect(result.message).toContain('Invalid value')
      expect(result.message).toContain('key: apiToken')
    })

    it('formats ConfigError without config key', () => {
      const error = new ConfigError('Config file not found')

      const result = formatErrorForDisplay(error)

      expect(result.message).not.toContain('key:')
    })

    it('formats InputError', () => {
      const error = new InputError('Invalid input')
      error.body = 'Expected a number'

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Invalid input')
      expect(result.message).toBe('Invalid input')
      expect(result.body).toBe('Expected a number')
    })

    it('formats generic Error', () => {
      const error = new Error('Something went wrong')

      const result = formatErrorForDisplay(error)

      expect(result.title).toBe('Unexpected error')
      expect(result.message).toBe('Something went wrong')
    })

    it('preserves Error.cause chain in message without debug mode', () => {
      // Regression: formatErrorForDisplay used to only surface causes
      // under showStack/verbose, so non-debug users lost the most useful
      // diagnostic context. See PR #1238.
      const inner = new Error('root DNS failure')
      const middle = new Error('network call failed', { cause: inner })
      const outer = new Error('API request failed', { cause: middle })

      const result = formatErrorForDisplay(outer)

      expect(result.message).toContain('API request failed')
      expect(result.message).toContain('network call failed')
      expect(result.message).toContain('root DNS failure')
    })

    it('stops walking causes at depth 5 to avoid runaway chains', () => {
      // Build inside-out so the outer Error sits at index 10 and chains
      // down through level-9, level-8, ..., level-0.
      let e: Error | undefined
      for (let i = 0; i <= 10; i++) {
        e = new Error(`level-${i}`, e ? { cause: e } : undefined)
      }

      const result = formatErrorForDisplay(e!)

      // Top message + 5 causes should appear.
      expect(result.message).toContain('level-10')
      expect(result.message).toContain('level-5')
      // Anything beyond depth 5 should have been truncated.
      expect(result.message).not.toContain('level-4')
    })

    it('uses custom title when provided', () => {
      const error = new Error('Something went wrong')

      const result = formatErrorForDisplay(error, { title: 'Custom Title' })

      expect(result.title).toBe('Custom Title')
    })

    it('formats string error', () => {
      const result = formatErrorForDisplay('Something went wrong')

      expect(result.title).toBe('Error')
      expect(result.message).toBe('Something went wrong')
    })

    it('formats unknown error', () => {
      const result = formatErrorForDisplay(42)

      expect(result.title).toBe('Unexpected error')
      expect(result.message).toBe('An unknown error occurred')
    })

    it('adds cause from options', () => {
      const result = formatErrorForDisplay('Error', { cause: 'Due to X' })

      expect(result.body).toBe('Due to X')
    })

    it('includes stack trace when showStack is true', () => {
      const error = new Error('Test error')

      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toBeDefined()
      expect(result.body).toContain('at ')
    })

    it('formats error cause chain when showStack is true', () => {
      const rootCause = new Error('Root cause')
      const middleCause = new Error('Middle cause', { cause: rootCause })
      const error = new Error('Top level error', { cause: middleCause })

      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toBeDefined()
      expect(result.body).toContain('Caused by')
      expect(result.body).toContain('Middle cause')
    })

    it('handles non-Error cause', () => {
      const error = new Error('Test error', { cause: 'String cause' })

      const result = formatErrorForDisplay(error, { showStack: true })

      expect(result.body).toBeDefined()
      expect(result.body).toContain('String cause')
    })

    it('limits cause chain depth to 5', () => {
      // Create a chain of 7 causes.
      let error: Error = new Error('Cause 1')
      for (let i = 2; i <= 7; i++) {
        error = new Error(`Cause ${i}`, { cause: error })
      }

      const result = formatErrorForDisplay(error, { showStack: true })

      // Should show up to 5 causes.
      expect(result.body).toBeDefined()
      expect(result.body).toContain('Caused by [1]')
      expect(result.body).toContain('Caused by [5]')
      // Cause 6 should not be shown.
      expect(result.body).not.toContain('Caused by [6]')
    })

    it('includes verbose body for unknown error types', () => {
      const result = formatErrorForDisplay(123, { verbose: true })

      expect(result.title).toBe('Unexpected error')
      expect(result.body).toBe('123')
    })
  })

  describe('formatErrorCompact', () => {
    it('returns error message for Error instances', () => {
      const error = new Error('Something went wrong')

      const result = formatErrorCompact(error)

      expect(result).toBe('Something went wrong')
    })

    it('returns string for string errors', () => {
      const result = formatErrorCompact('Something went wrong')

      expect(result).toBe('Something went wrong')
    })

    it('returns default message for unknown errors', () => {
      const result = formatErrorCompact(42)

      expect(result).toBe('An unknown error occurred')
    })
  })

  describe('formatErrorForTerminal', () => {
    it('includes title and message', () => {
      const error = new Error('Something went wrong')

      const result = formatErrorForTerminal(error)

      expect(result).toContain('Unexpected error')
      expect(result).toContain('Something went wrong')
    })

    it('includes recovery suggestions for AuthError', () => {
      const error = new AuthError('Token expired')

      const result = formatErrorForTerminal(error)

      expect(result).toContain('Suggested actions')
    })

    it('shows stack trace hint when body exists but not verbose', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at test.js:1:1'

      const result = formatErrorForTerminal(error, { showStack: true })

      // Should suggest running with verbose flag.
      expect(result).toContain('DEBUG=1')
    })

    it('shows full stack trace when verbose is true', () => {
      const error = new Error('Test error')
      error.stack = 'Error: Test error\n    at test.js:1:1'

      const result = formatErrorForTerminal(error, {
        showStack: true,
        verbose: true,
      })

      // Should show actual stack trace.
      expect(result).toContain('Stack trace')
    })
  })

  describe('formatErrorForJson', () => {
    it('returns CResult error format', () => {
      const error = new Error('Something went wrong')

      const result = formatErrorForJson(error)

      expect(result.ok).toBe(false)
      expect(result.message).toBeDefined()
      expect(result.cause).toBeDefined()
    })

    it('includes recovery suggestions for RateLimitError', () => {
      const error = new RateLimitError('Too many requests')

      const result = formatErrorForJson(error)

      expect(result.recovery).toBeDefined()
      expect(result.recovery!.length).toBeGreaterThan(0)
    })

    it('strips ANSI from output', () => {
      const error = new AuthError('Test error')

      const result = formatErrorForJson(error)

      // Should not contain ANSI escape codes.
      expect(result.message).not.toMatch(/\x1b\[/)
    })
  })

  describe('formatExternalCliError', () => {
    it('formats command name in error', () => {
      const error = new Error('Command failed')

      const result = formatExternalCliError('npx cdxgen', error)

      expect(result).toContain('npx cdxgen')
      expect(result).toContain('Command failed')
    })

    it('includes exit code when available', () => {
      const error = { code: 1, message: 'Failed' }

      const result = formatExternalCliError('npm install', error)

      expect(result).toContain('Exit code')
      expect(result).toContain('1')
    })

    it('includes stderr when available', () => {
      const error = { stderr: 'Error: Package not found\n', code: 1 }

      const result = formatExternalCliError('npm install', error)

      expect(result).toContain('Error output')
      expect(result).toContain('Package not found')
    })
  })

  describe('formatWarning', () => {
    it('formats warning message', () => {
      const result = formatWarning('This is a warning')

      expect(result).toContain('This is a warning')
    })

    it('includes details when provided', () => {
      const result = formatWarning('Warning', 'Some details here')

      expect(result).toContain('Warning')
      expect(result).toContain('Some details here')
    })
  })

  describe('formatSuccess', () => {
    it('formats success message', () => {
      const result = formatSuccess('Operation completed')

      expect(result).toContain('Operation completed')
    })

    it('includes details when provided', () => {
      const result = formatSuccess('Success', 'File saved')

      expect(result).toContain('Success')
      expect(result).toContain('File saved')
    })
  })

  describe('formatInfo', () => {
    it('formats info message', () => {
      const result = formatInfo('FYI')

      expect(result).toContain('FYI')
    })

    it('includes details when provided', () => {
      const result = formatInfo('Info', 'Additional info')

      expect(result).toContain('Info')
      expect(result).toContain('Additional info')
    })
  })
})
