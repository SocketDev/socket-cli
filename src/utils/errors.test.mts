import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AuthError,
  InputError,
  formatErrorWithDetail,
  getErrorCause,
  getErrorMessage,
  getErrorMessageOr,
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
