/**
 * Unit tests for custom error classes.
 *
 * Purpose: Tests custom error classes (InputError, AuthError, etc.). Validates
 * error construction and properties.
 *
 * Test Coverage: - InputError construction - AuthError construction - Error
 * message formatting - Error codes - Stack trace preservation.
 *
 * Testing Approach: Tests custom error class inheritance and behavior.
 *
 * Related Files: - util/error/errors.mts (implementation) -
 * errors-diagnostics.test.mts.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { UNKNOWN_ERROR } from '@socketsecurity/lib-stable/constants/sentinels'

import {
  AuthError,
  ConfigError,
  FileSystemError,
  getErrorCause,
  getErrorMessage,
  getErrorMessageOr,
  InputError,
  isErrnoException,
  NetworkError,
  RateLimitError,
  TimeoutError,
} from '../../../../src/util/error/errors.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Error Classes', () => {
  describe('AuthError', () => {
    it('should create an AuthError instance', () => {
      const error = new AuthError('Authentication failed')
      expect(error).toBeInstanceOf(AuthError)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Authentication failed')
      expect(error.name).toBe('AuthError')
    })

    it('should have default recovery suggestions', () => {
      const error = new AuthError('Auth failed')
      expect(error.recovery).toHaveLength(3)
      expect(error.recovery[0]).toContain('socket login')
    })

    it('should accept custom recovery suggestions', () => {
      const recovery = ['Custom recovery']
      const error = new AuthError('Auth failed', recovery)
      expect(error.recovery).toEqual(recovery)
    })
  })

  describe('NetworkError', () => {
    it('should create a NetworkError with status code', () => {
      const error = new NetworkError('Connection failed', 503)
      expect(error).toBeInstanceOf(NetworkError)
      expect(error.name).toBe('NetworkError')
      expect(error.message).toBe('Connection failed')
      expect(error.statusCode).toBe(503)
    })

    it('should have default recovery suggestions', () => {
      const error = new NetworkError('Timeout')
      expect(error.recovery).toHaveLength(3)
      expect(error.recovery[0]).toContain('internet connection')
    })
  })

  describe('RateLimitError', () => {
    it('should create a RateLimitError with retry after', () => {
      const error = new RateLimitError('Too many requests', 60)
      expect(error).toBeInstanceOf(RateLimitError)
      expect(error.name).toBe('RateLimitError')
      expect(error.retryAfter).toBe(60)
      expect(error.recovery[0]).toContain('60 seconds')
    })

    it('should handle missing retry after', () => {
      const error = new RateLimitError('Quota exceeded')
      expect(error.retryAfter).toBeUndefined()
      expect(error.recovery[0]).toContain('few minutes')
    })
  })

  describe('FileSystemError', () => {
    it('should create FileSystemError with ENOENT code', () => {
      const error = new FileSystemError('File not found', '/path', 'ENOENT')
      expect(error).toBeInstanceOf(FileSystemError)
      expect(error.name).toBe('FileSystemError')
      expect(error.path).toBe('/path')
      expect(error.code).toBe('ENOENT')
      expect(error.recovery[0]).toContain('exists')
    })

    it('should provide EACCES-specific recovery', () => {
      const error = new FileSystemError('Permission denied', '/etc', 'EACCES')
      expect(error.recovery[0]).toContain('permissions')
    })

    it('should provide ENOSPC-specific recovery', () => {
      const error = new FileSystemError('Disk full', '/tmp', 'ENOSPC')
      expect(error.recovery[0]).toContain('disk space')
    })

    it('shares EACCES recovery with EPERM code', () => {
      const error = new FileSystemError(
        'Operation not permitted',
        '/etc',
        'EPERM',
      )
      expect(error.recovery[0]).toContain('permissions')
    })

    it('falls back to generic recovery for unknown error codes', () => {
      const error = new FileSystemError('Unknown error', '/tmp', 'EWHATEVER')
      expect(error.recovery[0]).toContain('file system permissions')
    })

    it('falls back to generic recovery when code is undefined', () => {
      const error = new FileSystemError('Unknown error')
      expect(error.recovery[0]).toContain('file system permissions')
    })

    it('uses provided custom recovery instead of defaults', () => {
      const error = new FileSystemError('x', '/p', 'ENOENT', ['custom rec'])
      expect(error.recovery).toEqual(['custom rec'])
    })
  })

  describe('calculateStringSimilarity', () => {
    it('returns 1 for identical strings (early-return)', async () => {
      const { calculateStringSimilarity } =
        await import('../../../../src/util/error/errors.mts')
      expect(calculateStringSimilarity('exact', 'exact')).toBe(1)
    })

    it('returns 0 when both strings have only short words (no overlap signal)', async () => {
      const { calculateStringSimilarity } =
        await import('../../../../src/util/error/errors.mts')
      expect(calculateStringSimilarity('a b c', 'd e f')).toBe(0)
    })

    it('returns a fractional value for partial overlap', async () => {
      const { calculateStringSimilarity } =
        await import('../../../../src/util/error/errors.mts')
      const score = calculateStringSimilarity(
        'fetch request failed',
        'fetch request succeeded',
      )
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(1)
    })

    it('returns close to 1 for nearly-identical phrasing', async () => {
      const { calculateStringSimilarity } =
        await import('../../../../src/util/error/errors.mts')
      const score = calculateStringSimilarity(
        'invalid json format in request body',
        'request body has invalid json format',
      )
      expect(score).toBeGreaterThan(0.7)
    })
  })

  describe('captureException / captureExceptionSync', () => {
    it('captureExceptionSync returns "" when Sentry is not configured', async () => {
      const { captureExceptionSync } =
        await import('../../../../src/util/error/errors.mts')
      const result = captureExceptionSync(new Error('boom'))
      expect(result).toBe('')
    })

    it('captureException returns "" when Sentry is not configured', async () => {
      const { captureException } =
        await import('../../../../src/util/error/errors.mts')
      const result = await captureException(new Error('boom'))
      expect(result).toBe('')
    })
  })

  describe('ConfigError', () => {
    it('should create ConfigError with config key', () => {
      const error = new ConfigError('Invalid value', 'apiToken')
      expect(error).toBeInstanceOf(ConfigError)
      expect(error.name).toBe('ConfigError')
      expect(error.configKey).toBe('apiToken')
      expect(error.recovery[0]).toContain('config list')
    })
  })

  describe('InputError', () => {
    it('should create an InputError with message only', () => {
      const error = new InputError('Invalid input')
      expect(error).toBeInstanceOf(InputError)
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Invalid input')
      expect(error.body).toBeUndefined()
    })

    it('should create an InputError with message and body', () => {
      const error = new InputError('Invalid JSON', '{invalid}')
      expect(error.message).toBe('Invalid JSON')
      expect(error.body).toBe('{invalid}')
    })
  })

  describe('TimeoutError', () => {
    it('should create TimeoutError with timeout and elapsed times', () => {
      const error = new TimeoutError('Request timed out', 30_000, 35_000)
      expect(error).toBeInstanceOf(TimeoutError)
      expect(error.name).toBe('TimeoutError')
      expect(error.message).toBe('Request timed out')
      expect(error.timeoutMs).toBe(30_000)
      expect(error.elapsedMs).toBe(35_000)
    })

    it('should have default recovery suggestions', () => {
      const error = new TimeoutError('Timeout')
      expect(error.recovery).toHaveLength(3)
      expect(error.recovery[0]).toContain('internet connection')
    })

    it('should accept custom recovery suggestions', () => {
      const recovery = ['Retry with exponential backoff']
      const error = new TimeoutError('Timeout', 10_000, 15_000, recovery)
      expect(error.recovery).toEqual(recovery)
    })

    it('should handle missing timeout values', () => {
      const error = new TimeoutError('Operation timed out')
      expect(error.timeoutMs).toBeUndefined()
      expect(error.elapsedMs).toBeUndefined()
    })
  })
})

describe('Error Narrowing', () => {
  it('should properly detect node errors', () => {
    try {
      readFileSync(path.join(__dirname, 'enoent'))
    } catch (e) {
      expect(isErrnoException(e)).toBe(true)
    }
  })
  it('should properly only detect node errors', () => {
    expect(isErrnoException(new Error())).toBe(false)
    // Object.assign intentionally strips the Error prototype — the point is a
    // plain object with error-shaped own properties.
    expect(isErrnoException(Object.assign({}, new Error()))).toBe(false)
  })
  it('should return false for non-error values', () => {
    expect(isErrnoException('string')).toBe(false)
    expect(isErrnoException(undefined)).toBe(false)
    expect(isErrnoException(undefined)).toBe(false)
    expect(isErrnoException(123)).toBe(false)
    expect(isErrnoException({})).toBe(false)
  })
})

describe('getErrorMessage', () => {
  it('should extract message from Error object', () => {
    const error = new Error('Test error message')
    expect(getErrorMessage(error)).toBe('Test error message')
  })

  it('should extract message from custom error types', () => {
    const authError = new AuthError('Auth failed')
    const inputError = new InputError('Bad input')
    expect(getErrorMessage(authError)).toBe('Auth failed')
    expect(getErrorMessage(inputError)).toBe('Bad input')
  })

  it('should return undefined for non-error values', () => {
    expect(getErrorMessage(undefined)).toBeUndefined()
    expect(getErrorMessage(undefined)).toBeUndefined()
    expect(getErrorMessage('string')).toBeUndefined()
    expect(getErrorMessage(123)).toBeUndefined()
    expect(getErrorMessage({})).toBeUndefined()
  })

  it('should handle errors with empty messages', () => {
    const error = new Error('')
    expect(getErrorMessage(error)).toBe('')
  })
})

describe('getErrorMessageOr', () => {
  it('should extract message from Error object', () => {
    const error = new Error('Test error')
    expect(getErrorMessageOr(error, 'fallback')).toBe('Test error')
  })

  it('should return fallback for non-error values', () => {
    expect(getErrorMessageOr(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessageOr(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessageOr('string', 'fallback')).toBe('fallback')
    expect(getErrorMessageOr(123, 'fallback')).toBe('fallback')
  })

  it('should return fallback for error with empty message', () => {
    const error = new Error('')
    expect(getErrorMessageOr(error, 'fallback')).toBe('fallback')
  })

  it('should use different fallback messages', () => {
    expect(getErrorMessageOr(undefined, 'Custom fallback 1')).toBe(
      'Custom fallback 1',
    )
    expect(getErrorMessageOr(undefined, 'Custom fallback 2')).toBe(
      'Custom fallback 2',
    )
  })
})

describe('getErrorCause', () => {
  it('should extract error message as cause', () => {
    const error = new Error('Something went wrong')
    expect(getErrorCause(error)).toBe('Something went wrong')
  })

  it('should return UNKNOWN_ERROR for non-error values', () => {
    expect(getErrorCause(undefined)).toBe(UNKNOWN_ERROR)
    expect(getErrorCause(undefined)).toBe(UNKNOWN_ERROR)
    expect(getErrorCause('string')).toBe(UNKNOWN_ERROR)
    expect(getErrorCause(123)).toBe(UNKNOWN_ERROR)
  })

  it('should return UNKNOWN_ERROR for error with empty message', () => {
    const error = new Error('')
    expect(getErrorCause(error)).toBe(UNKNOWN_ERROR)
  })
})
