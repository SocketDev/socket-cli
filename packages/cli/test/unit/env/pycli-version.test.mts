/**
 * Unit tests for PyCLI version getter.
 *
 * Related Files: - src/env/pycli-version.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPyCliVersion } from '../../../src/env/pycli-version.mts'

describe('env/pycli-version', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_PYCLI_VERSION']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_PYCLI_VERSION'] = original
    } else {
      delete process.env['INLINED_PYCLI_VERSION']
    }
  })

  it('returns the version string when the env var is set', () => {
    process.env['INLINED_PYCLI_VERSION'] = '0.8.0'
    expect(getPyCliVersion()).toBe('0.8.0')
  })

  it('throws when the env var is missing', () => {
    delete process.env['INLINED_PYCLI_VERSION']
    expect(() => getPyCliVersion()).toThrow(/INLINED_PYCLI_VERSION/)
  })

  it('throws when the env var is the empty string', () => {
    process.env['INLINED_PYCLI_VERSION'] = ''
    expect(() => getPyCliVersion()).toThrow(/INLINED_PYCLI_VERSION/)
  })
})
