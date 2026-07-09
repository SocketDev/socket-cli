/**
 * Unit tests for custom error classes.
 *
 * Covers formatErrorWithDetail, hasRecoverySuggestions,
 * getRecoverySuggestions, getNetworkErrorCode, getNetworkErrorDiagnostics,
 * and buildErrorCause.
 *
 * Related Files: - util/error/errors.mts (implementation) - errors.test.mts.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  AuthError,
  buildErrorCause,
  ConfigError,
  FileSystemError,
  formatErrorWithDetail,
  getNetworkErrorCode,
  getNetworkErrorDiagnostics,
  getRecoverySuggestions,
  hasRecoverySuggestions,
  InputError,
  NetworkError,
  RateLimitError,
} from '../../../../src/util/error/errors.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
    expect(formatErrorWithDetail('Task failed', undefined)).toBe('Task failed')
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
      expect(hasRecoverySuggestions(undefined)).toBe(false)
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
      expect(getRecoverySuggestions(undefined)).toEqual([])
      expect(getRecoverySuggestions(undefined)).toEqual([])
    })
  })
})

describe('Network Error Diagnostics', () => {
  describe('getNetworkErrorCode', () => {
    it('should extract error code from ErrnoException', () => {
      try {
        readFileSync(path.join(__dirname, 'nonexistent'))
      } catch (e) {
        const code = getNetworkErrorCode(e)
        expect(code).toBe('ENOENT')
      }
    })

    it('should return undefined for errors without code', () => {
      const error = new Error('Generic error')
      expect(getNetworkErrorCode(error)).toBeUndefined()
    })

    it('should return undefined for non-errors', () => {
      expect(getNetworkErrorCode('string')).toBeUndefined()
      expect(getNetworkErrorCode(undefined)).toBeUndefined()
      expect(getNetworkErrorCode(undefined)).toBeUndefined()
    })
  })

  describe('getNetworkErrorDiagnostics', () => {
    it('should provide timeout diagnostics for ETIMEDOUT', () => {
      const error = Object.assign(new Error('Connection timed out'), {
        code: 'ETIMEDOUT',
      })
      const diagnostics = getNetworkErrorDiagnostics(error, 5000)
      expect(diagnostics).toContain('timeout')
      expect(diagnostics).toContain('5s')
      expect(diagnostics).toContain('💡 Try:')
      expect(diagnostics).toContain('internet connection')
    })

    it('should provide connection refused diagnostics for ECONNREFUSED', () => {
      const error = Object.assign(new Error('Connection refused'), {
        code: 'ECONNREFUSED',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('Connection refused')
      expect(diagnostics).toContain('proxy')
      expect(diagnostics).toContain('firewall')
    })

    it('should provide DNS diagnostics for ENOTFOUND', () => {
      const error = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        code: 'ENOTFOUND',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('DNS')
      expect(diagnostics).toContain('8.8.8.8')
      expect(diagnostics).toContain('1.1.1.1')
    })

    it('should provide certificate diagnostics for cert errors', () => {
      const error = Object.assign(new Error('Certificate has expired'), {
        code: 'CERT_HAS_EXPIRED',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('certificate')
      expect(diagnostics).toContain('date and time')
    })

    it('should provide network unreachable diagnostics', () => {
      const error = Object.assign(new Error('Network is unreachable'), {
        code: 'ENETUNREACH',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('unreachable')
      expect(diagnostics).toContain('internet connection')
    })

    it('should provide generic diagnostics for unknown errors', () => {
      const error = new Error('Unknown network issue')
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('Network error')
      expect(diagnostics).toContain('💡 Try:')
      expect(diagnostics).toContain('internet connection')
    })

    it('should detect timeout based on duration', () => {
      const error = new Error('Request failed')
      const diagnostics = getNetworkErrorDiagnostics(error, 35_000)
      expect(diagnostics).toContain('timeout')
      expect(diagnostics).toContain('35s')
    })

    it('should provide diagnostics for ECONNRESET', () => {
      const error = Object.assign(new Error('Connection reset'), {
        code: 'ECONNRESET',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('timeout')
    })

    it('should provide diagnostics for ESOCKETTIMEDOUT', () => {
      const error = Object.assign(new Error('Socket timeout'), {
        code: 'ESOCKETTIMEDOUT',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('timeout')
    })

    it('should provide diagnostics for EAI_AGAIN', () => {
      const error = Object.assign(new Error('DNS lookup failed'), {
        code: 'EAI_AGAIN',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('DNS')
    })

    it('should provide diagnostics for certificate issues', () => {
      const error = Object.assign(new Error('Unable to verify'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('certificate')
    })

    it('should provide diagnostics for self-signed certs', () => {
      const error = Object.assign(new Error('Self-signed cert'), {
        code: 'SELF_SIGNED_CERT_IN_CHAIN',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('certificate')
    })

    it('should provide diagnostics for EHOSTUNREACH', () => {
      const error = Object.assign(new Error('Host unreachable'), {
        code: 'EHOSTUNREACH',
      })
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('unreachable')
    })

    it('should detect certificate keyword in message', () => {
      const error = new Error('certificate validation failed')
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('certificate')
    })

    it('should detect getaddrinfo in message', () => {
      const error = new Error('getaddrinfo failed')
      const diagnostics = getNetworkErrorDiagnostics(error)
      expect(diagnostics).toContain('DNS')
    })
  })
})

describe('buildErrorCause', () => {
  it('should return message with reason appended', async () => {
    const result = await buildErrorCause(
      400,
      'Bad request',
      'Invalid parameter',
    )
    expect(result).toBe('Bad request (reason: Invalid parameter)')
  })

  it('should return message only when reason matches message', async () => {
    const result = await buildErrorCause(400, 'Invalid input', 'Invalid input')
    expect(result).toBe('Invalid input')
  })

  it('should return message only when no reason provided', async () => {
    const result = await buildErrorCause(400, 'Bad request', '')
    expect(result).toBe('Bad request')
  })

  it('should skip redundant reasons with high similarity', async () => {
    const result = await buildErrorCause(
      400,
      'Invalid JSON format in request body',
      'Request body has invalid JSON format',
    )
    // Should not add reason because they are too similar.
    expect(result).not.toContain('reason')
  })

  it('should include reason when messages are sufficiently different', async () => {
    const result = await buildErrorCause(
      400,
      'Request failed',
      'Missing required field: name',
    )
    expect(result).toContain('reason')
    expect(result).toContain('Missing required field')
  })

  it('should handle 429 rate limit errors specially', async () => {
    const result = await buildErrorCause(429, 'Rate limited', 'Quota exceeded')
    // Should include quota message.
    expect(result).toContain('Quota exceeded')
  })

  it('should handle 429 with message but no reason', async () => {
    const result = await buildErrorCause(
      429,
      'Too many requests',
      'No error message returned',
    )
    expect(result).toContain('Too many requests')
  })

  it('should handle 429 with no useful error info', async () => {
    const result = await buildErrorCause(
      429,
      'No error message returned',
      'No error message returned',
    )
    // Should return quota message.
    expect(result.length).toBeGreaterThan(0)
  })

  it('appends reason when both strings have only short words (no overlap signal)', async () => {
    // Forces calculateStringSimilarity to take the empty word-sets branch
    // (all tokens <= 2 chars) — similarity returns 0 → reason is appended.
    const result = await buildErrorCause(400, 'a b c', 'd e f')
    expect(result).toContain('reason: d e f')
  })
})
