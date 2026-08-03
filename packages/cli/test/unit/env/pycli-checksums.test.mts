/**
 * Unit tests for PyCli checksums getter.
 *
 * Related Files: - src/env/pycli-checksums.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getPyCliChecksums } from '../../../src/env/pycli-checksums.mts'

describe('env/pycli-checksums', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_PYCLI_CHECKSUMS']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_PYCLI_CHECKSUMS'] = original
    } else {
      delete process.env['INLINED_PYCLI_CHECKSUMS']
    }
  })

  describe('getPyCliChecksums', () => {
    it('returns empty object when env is missing (dev mode)', () => {
      delete process.env['INLINED_PYCLI_CHECKSUMS']
      expect(getPyCliChecksums()).toEqual({})
    })

    it('parses inlined JSON checksums', () => {
      process.env['INLINED_PYCLI_CHECKSUMS'] = JSON.stringify({
        'pycli-1.0': 'sha-1',
      })
      expect(getPyCliChecksums()).toEqual({ 'pycli-1.0': 'sha-1' })
    })

    it('throws when env contains malformed JSON', () => {
      process.env['INLINED_PYCLI_CHECKSUMS'] = '{bad'
      expect(() => getPyCliChecksums()).toThrow(/PyCLI.*not valid JSON/)
    })
  })
})
