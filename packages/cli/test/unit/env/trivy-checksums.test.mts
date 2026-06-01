/**
 * Unit tests for Trivy checksums getter.
 *
 * Related Files: - src/env/trivy-checksums.mts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getTrivyChecksums,
  requireTrivyChecksum,
} from '../../../src/env/trivy-checksums.mts'

describe('env/trivy-checksums', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_TRIVY_CHECKSUMS']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_TRIVY_CHECKSUMS'] = original
    } else {
      delete process.env['INLINED_TRIVY_CHECKSUMS']
    }
  })

  describe('getTrivyChecksums', () => {
    it('returns empty object when env is missing (dev mode)', () => {
      delete process.env['INLINED_TRIVY_CHECKSUMS']
      expect(getTrivyChecksums()).toEqual({})
    })

    it('parses inlined JSON checksums', () => {
      process.env['INLINED_TRIVY_CHECKSUMS'] = JSON.stringify({
        'trivy-darwin-arm64': 'sha-trivy',
      })
      expect(getTrivyChecksums()).toEqual({ 'trivy-darwin-arm64': 'sha-trivy' })
    })

    it('throws when env contains malformed JSON', () => {
      process.env['INLINED_TRIVY_CHECKSUMS'] = '{not'
      expect(() => getTrivyChecksums()).toThrow(/Trivy.*not valid JSON/)
    })
  })

  describe('requireTrivyChecksum', () => {
    it('returns undefined in dev mode', () => {
      delete process.env['INLINED_TRIVY_CHECKSUMS']
      expect(requireTrivyChecksum('trivy-darwin-arm64')).toBeUndefined()
    })

    it('returns checksum for a known asset', () => {
      process.env['INLINED_TRIVY_CHECKSUMS'] = JSON.stringify({
        'trivy-darwin-arm64': 'sha-trivy',
      })
      expect(requireTrivyChecksum('trivy-darwin-arm64')).toBe('sha-trivy')
    })

    it('throws for unknown asset in production mode', () => {
      process.env['INLINED_TRIVY_CHECKSUMS'] = JSON.stringify({
        'trivy-darwin-arm64': 'sha-trivy',
      })
      expect(() => requireTrivyChecksum('trivy-windows-x64')).toThrow(
        /Trivy has no SHA-256 checksum/,
      )
    })
  })
})
