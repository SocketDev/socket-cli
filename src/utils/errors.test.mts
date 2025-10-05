import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AuthError,
  ConfigError,
  FileSystemError,
  InputError,
  NetworkError,
  RateLimitError,
  formatErrorWithDetail,
  getErrorCause,
  getErrorMessage,
  getErrorMessageOr,
  getRecoverySuggestions,
  hasRecoverySuggestions,
  isErrnoException,
} from './errors.mts'
import { UNKNOWN_ERROR } from '../constants.mts'

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
    expect(isErrnoException({ ...new Error() })).toBe(false)
  })
  it('should return false for non-error values', () => {
    expect(isErrnoException('string')).toBe(false)
    expect(isErrnoException(null)).toBe(false)
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
    expect(getErrorMessage(null)).toBeUndefined()
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
    expect(getErrorMessageOr(null, 'fallback')).toBe('fallback')
    expect(getErrorMessageOr(undefined, 'fallback')).toBe('fallback')
    expect(getErrorMessageOr('string', 'fallback')).toBe('fallback')
    expect(getErrorMessageOr(123, 'fallback')).toBe('fallback')
  })

  it('should return fallback for error with empty message', () => {
    const error = new Error('')
    expect(getErrorMessageOr(error, 'fallback')).toBe('fallback')
  })

  it('should use different fallback messages', () => {
    expect(getErrorMessageOr(null, 'Custom fallback 1')).toBe(
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
    expect(getErrorCause(null)).toBe(UNKNOWN_ERROR)
    expect(getErrorCause(undefined)).toBe(UNKNOWN_ERROR)
    expect(getErrorCause('string')).toBe(UNKNOWN_ERROR)
    expect(getErrorCause(123)).toBe(UNKNOWN_ERROR)
  })

  it('should return UNKNOWN_ERROR for error with empty message', () => {
    const error = new Error('')
    expect(getErrorCause(error)).toBe(UNKNOWN_ERROR)
  })
})

describe('formatErrorWithDetail', () => {
  it('should format message with error detail', () => {
    const error = new Error('ENOENT: no such file or directory')
    expect(formatErrorWithDetail('Failed to delete file', error)).toBe(
      'Failed to delete file: ENOENT: no such file or directory',
    )
  })

  it('should return base message when error has no message', () => {
    const error = new Error('')
    expect(formatErrorWithDetail('Operation failed', error)).toBe(
      'Operation failed',
    )
  })

  it('should return base message for non-error values', () => {
    expect(formatErrorWithDetail('Task failed', null)).toBe('Task failed')
    expect(formatErrorWithDetail('Task failed', undefined)).toBe('Task failed')
    expect(formatErrorWithDetail('Task failed', 'string')).toBe('Task failed')
  })

  it('should handle different base messages and errors', () => {
    const error1 = new Error('Network timeout')
    const error2 = new AuthError('Invalid token')
    const error3 = new InputError('Missing parameter', 'body')

    expect(formatErrorWithDetail('Connection failed', error1)).toBe(
      'Connection failed: Network timeout',
    )
    expect(formatErrorWithDetail('Authentication failed', error2)).toBe(
      'Authentication failed: Invalid token',
    )
    expect(formatErrorWithDetail('Validation failed', error3)).toBe(
      'Validation failed: Missing parameter',
    )
  })

  it('should handle base message with special characters', () => {
    const error = new Error('File not found')
    expect(formatErrorWithDetail('Failed to process "test.txt"', error)).toBe(
      'Failed to process "test.txt": File not found',
    )
  })
})

describe('Recovery Utilities', () => {
  describe('hasRecoverySuggestions', () => {
    it('should return true for errors with recovery', () => {
      const error = new AuthError('Test')
      expect(hasRecoverySuggestions(error)).toBe(true)
    })

    it('should return false for standard errors', () => {
      const error = new Error('Standard error')
      expect(hasRecoverySuggestions(error)).toBe(false)
    })

    it('should return false for non-errors', () => {
      expect(hasRecoverySuggestions('string')).toBe(false)
      expect(hasRecoverySuggestions(null)).toBe(false)
      expect(hasRecoverySuggestions(undefined)).toBe(false)
      expect(hasRecoverySuggestions(123)).toBe(false)
    })
  })

  describe('getRecoverySuggestions', () => {
    it('should extract recovery from NetworkError', () => {
      const error = new NetworkError('Connection failed')
      const suggestions = getRecoverySuggestions(error)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0]).toContain('internet connection')
    })

    it('should extract recovery from RateLimitError', () => {
      const error = new RateLimitError('Too many requests', 30)
      const suggestions = getRecoverySuggestions(error)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0]).toContain('30 seconds')
    })

    it('should extract recovery from FileSystemError', () => {
      const error = new FileSystemError('No access', '/etc', 'EACCES')
      const suggestions = getRecoverySuggestions(error)
      expect(suggestions[0]).toContain('permissions')
    })

    it('should extract recovery from ConfigError', () => {
      const error = new ConfigError('Bad config')
      const suggestions = getRecoverySuggestions(error)
      expect(suggestions[0]).toContain('config list')
    })

    it('should return empty array for standard errors', () => {
      const error = new Error('Standard error')
      const suggestions = getRecoverySuggestions(error)
      expect(suggestions).toEqual([])
    })

    it('should return empty array for non-errors', () => {
      expect(getRecoverySuggestions('string')).toEqual([])
      expect(getRecoverySuggestions(null)).toEqual([])
      expect(getRecoverySuggestions(undefined)).toEqual([])
    })
  })
})
