/**
 * Unit tests for TruffleHog version getter.
 *
 * Related Files: - src/env/trufflehog-version.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getTrufflehogVersion } from '../../../src/env/trufflehog-version.mts'

describe('env/trufflehog-version', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_TRUFFLEHOG_VERSION']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_TRUFFLEHOG_VERSION'] = original
    } else {
      delete process.env['INLINED_TRUFFLEHOG_VERSION']
    }
  })

  it('returns the version string when the env var is set', () => {
    process.env['INLINED_TRUFFLEHOG_VERSION'] = '3.80.0'
    expect(getTrufflehogVersion()).toBe('3.80.0')
  })

  it('throws when the env var is missing', () => {
    delete process.env['INLINED_TRUFFLEHOG_VERSION']
    expect(() => getTrufflehogVersion()).toThrow(/INLINED_TRUFFLEHOG_VERSION/)
  })

  it('throws when the env var is the empty string', () => {
    process.env['INLINED_TRUFFLEHOG_VERSION'] = ''
    expect(() => getTrufflehogVersion()).toThrow(/INLINED_TRUFFLEHOG_VERSION/)
  })
})
