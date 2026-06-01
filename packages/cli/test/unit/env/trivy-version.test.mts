/**
 * Unit tests for Trivy version getter.
 *
 * Related Files: - src/env/trivy-version.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getTrivyVersion } from '../../../src/env/trivy-version.mts'

describe('env/trivy-version', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_TRIVY_VERSION']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_TRIVY_VERSION'] = original
    } else {
      delete process.env['INLINED_TRIVY_VERSION']
    }
  })

  it('returns the version string when the env var is set', () => {
    process.env['INLINED_TRIVY_VERSION'] = '0.50.0'
    expect(getTrivyVersion()).toBe('0.50.0')
  })

  it('throws when the env var is missing', () => {
    delete process.env['INLINED_TRIVY_VERSION']
    expect(() => getTrivyVersion()).toThrow(/INLINED_TRIVY_VERSION/)
  })

  it('throws when the env var is the empty string', () => {
    process.env['INLINED_TRIVY_VERSION'] = ''
    expect(() => getTrivyVersion()).toThrow(/INLINED_TRIVY_VERSION/)
  })
})
