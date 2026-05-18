/**
 * Unit tests for SFW checksums getter.
 *
 * Related Files: - src/env/sfw-checksums.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getSfwChecksums,
  requireSfwChecksum,
} from '../../../src/env/sfw-checksums.mts'

describe('env/sfw-checksums', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_SFW_CHECKSUMS']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_SFW_CHECKSUMS'] = original
    } else {
      delete process.env['INLINED_SFW_CHECKSUMS']
    }
  })

  describe('getSfwChecksums', () => {
    it('returns empty object when env is missing (dev mode)', () => {
      delete process.env['INLINED_SFW_CHECKSUMS']
      expect(getSfwChecksums()).toEqual({})
    })

    it('parses inlined JSON checksums', () => {
      process.env['INLINED_SFW_CHECKSUMS'] = JSON.stringify({
        'sfw-darwin-arm64': 'sha-sfw',
      })
      expect(getSfwChecksums()).toEqual({ 'sfw-darwin-arm64': 'sha-sfw' })
    })

    it('throws when env contains malformed JSON', () => {
      process.env['INLINED_SFW_CHECKSUMS'] = '{not'
      expect(() => getSfwChecksums()).toThrow(/SFW.*not valid JSON/)
    })
  })

  describe('requireSfwChecksum', () => {
    it('returns undefined in dev mode', () => {
      delete process.env['INLINED_SFW_CHECKSUMS']
      expect(requireSfwChecksum('sfw-darwin-arm64')).toBeUndefined()
    })

    it('returns checksum for a known asset', () => {
      process.env['INLINED_SFW_CHECKSUMS'] = JSON.stringify({
        'sfw-darwin-arm64': 'sha-sfw',
      })
      expect(requireSfwChecksum('sfw-darwin-arm64')).toBe('sha-sfw')
    })

    it('throws for unknown asset in production mode', () => {
      process.env['INLINED_SFW_CHECKSUMS'] = JSON.stringify({
        'sfw-darwin-arm64': 'sha-sfw',
      })
      expect(() => requireSfwChecksum('sfw-windows-x64')).toThrow(
        /SFW has no SHA-256 checksum/,
      )
    })
  })
})
