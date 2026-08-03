/**
 * Unit tests for the Sentry capture boundary.
 *
 * Purpose: Proves credentials are stripped from an exception before it is
 * handed to Sentry, and that the caller's own error object survives intact.
 *
 * Test Coverage: - redactExceptionForCapture over strings, errors, cause
 * chains, non-error values, and deep chains.
 *
 * Related Files: - src/util/error/errors-sentry.mts (implementation)
 */

import { describe, expect, it } from 'vitest'

import { redactExceptionForCapture } from '../../../../src/util/error/errors-sentry.mts'

// Obviously fake. Full pattern coverage lives in
// test/unit/util/redact-secrets-from-text.test.mts.
const SYNTHETIC_TOKEN = 'ghp_SYNTHETIC00000000000000'

describe('redactExceptionForCapture', () => {
  it('redacts a thrown string', () => {
    expect(redactExceptionForCapture(`GITHUB_TOKEN=${SYNTHETIC_TOKEN}`)).toBe(
      'GITHUB_TOKEN=[redacted]',
    )
  })

  it('redacts the error message', () => {
    const error = new Error(`auth failed with ${SYNTHETIC_TOKEN}`)

    const redacted = redactExceptionForCapture(error) as Error

    expect(redacted.message).toBe('auth failed with [redacted]')
  })

  it('redacts the stack', () => {
    const error = new Error('spawn failed')
    error.stack = `Error: spawn failed\n    at run (socket --api-token ${SYNTHETIC_TOKEN})`

    const redacted = redactExceptionForCapture(error) as Error

    expect(redacted.stack).not.toContain(SYNTHETIC_TOKEN)
  })

  it('redacts the cause chain', () => {
    const error = new Error('outer', {
      cause: new Error(`inner ${SYNTHETIC_TOKEN}`),
    })

    const redacted = redactExceptionForCapture(error) as Error

    expect((redacted.cause as Error).message).toBe('inner [redacted]')
  })

  it('leaves the caller error object unchanged', () => {
    const message = `auth failed with ${SYNTHETIC_TOKEN}`
    const error = new Error(message)

    redactExceptionForCapture(error)

    expect(error.message).toBe(message)
  })

  it('preserves the error prototype so Sentry grouping still works', () => {
    const error = new TypeError(`bad ${SYNTHETIC_TOKEN}`)

    const redacted = redactExceptionForCapture(error)

    expect(redacted).toBeInstanceOf(TypeError)
  })

  it('preserves own enumerable properties', () => {
    const error = Object.assign(new Error(`bad ${SYNTHETIC_TOKEN}`), {
      code: 'ENOENT',
    })

    const redacted = redactExceptionForCapture(error) as Error & {
      code: string
    }

    expect(redacted.code).toBe('ENOENT')
  })

  it('returns a non-error value untouched', () => {
    const value = { note: 'not an error' }

    expect(redactExceptionForCapture(value)).toBe(value)
  })

  it('stops walking past the cause depth cap', () => {
    let error = new Error(`deepest ${SYNTHETIC_TOKEN}`)
    for (let i = 0; i < 6; i += 1) {
      error = new Error(`level ${i}`, { cause: error })
    }

    const redacted = redactExceptionForCapture(error) as Error

    let current: unknown = redacted
    let depth = 0
    while (current instanceof Error && current.cause !== undefined) {
      current = current.cause
      depth += 1
    }
    expect(depth).toBe(6)
    expect((current as Error).message).toContain(SYNTHETIC_TOKEN)
  })
})
