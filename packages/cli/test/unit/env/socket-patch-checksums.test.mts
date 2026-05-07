/**
 * Unit tests for Socket Patch checksums getter.
 *
 * Related Files:
 * - src/env/socket-patch-checksums.mts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getSocketPatchChecksums,
  requireSocketPatchChecksum,
} from '../../../src/env/socket-patch-checksums.mts'

describe('env/socket-patch-checksums', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_SOCKET_PATCH_CHECKSUMS']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_SOCKET_PATCH_CHECKSUMS'] = original
    } else {
      delete process.env['INLINED_SOCKET_PATCH_CHECKSUMS']
    }
  })

  describe('getSocketPatchChecksums', () => {
    it('returns empty object when env is missing (dev mode)', () => {
      delete process.env['INLINED_SOCKET_PATCH_CHECKSUMS']
      expect(getSocketPatchChecksums()).toEqual({})
    })

    it('parses inlined JSON checksums', () => {
      process.env['INLINED_SOCKET_PATCH_CHECKSUMS'] = JSON.stringify({
        'patch-1.0.tar.gz': 'sha-patch',
      })
      expect(getSocketPatchChecksums()).toEqual({
        'patch-1.0.tar.gz': 'sha-patch',
      })
    })

    it('throws when env contains malformed JSON', () => {
      process.env['INLINED_SOCKET_PATCH_CHECKSUMS'] = '{not'
      expect(() => getSocketPatchChecksums()).toThrow(
        /Socket Patch.*not valid JSON/,
      )
    })
  })

  describe('requireSocketPatchChecksum', () => {
    it('returns undefined in dev mode', () => {
      delete process.env['INLINED_SOCKET_PATCH_CHECKSUMS']
      expect(requireSocketPatchChecksum('patch-1.0.tar.gz')).toBeUndefined()
    })

    it('returns checksum for a known asset', () => {
      process.env['INLINED_SOCKET_PATCH_CHECKSUMS'] = JSON.stringify({
        'patch-1.0.tar.gz': 'sha-patch',
      })
      expect(requireSocketPatchChecksum('patch-1.0.tar.gz')).toBe('sha-patch')
    })

    it('throws for unknown asset in production mode', () => {
      process.env['INLINED_SOCKET_PATCH_CHECKSUMS'] = JSON.stringify({
        'patch-1.0.tar.gz': 'sha-patch',
      })
      expect(() => requireSocketPatchChecksum('patch-9.9.tar.gz')).toThrow(
        /Socket Patch has no SHA-256 checksum/,
      )
    })
  })
})
