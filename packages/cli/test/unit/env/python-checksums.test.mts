/**
 * Unit tests for Python checksums getter.
 *
 * Reads INLINED_PYTHON_CHECKSUMS from process.env directly so esbuild's
 * define plugin can inline the JSON at build time. Tests verify dev-mode
 * fallback (empty object), production parsing, and the require-checksum
 * lookup path.
 *
 * Related Files:
 * - src/env/python-checksums.mts
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  getPythonChecksums,
  requirePythonChecksum,
} from '../../../src/env/python-checksums.mts'

describe('env/python-checksums', () => {
  let original: string | undefined

  beforeEach(() => {
    original = process.env['INLINED_PYTHON_CHECKSUMS']
  })

  afterEach(() => {
    if (original !== undefined) {
      process.env['INLINED_PYTHON_CHECKSUMS'] = original
    } else {
      delete process.env['INLINED_PYTHON_CHECKSUMS']
    }
  })

  describe('getPythonChecksums', () => {
    it('returns empty object when env is missing (dev mode)', () => {
      delete process.env['INLINED_PYTHON_CHECKSUMS']
      expect(getPythonChecksums()).toEqual({})
    })

    it('returns empty object when env is empty string', () => {
      process.env['INLINED_PYTHON_CHECKSUMS'] = ''
      expect(getPythonChecksums()).toEqual({})
    })

    it('parses inlined JSON checksums', () => {
      process.env['INLINED_PYTHON_CHECKSUMS'] = JSON.stringify({
        'python-3.12.tar.gz': 'abc123',
        'python-3.13.tar.gz': 'def456',
      })
      expect(getPythonChecksums()).toEqual({
        'python-3.12.tar.gz': 'abc123',
        'python-3.13.tar.gz': 'def456',
      })
    })

    it('throws when env contains malformed JSON', () => {
      process.env['INLINED_PYTHON_CHECKSUMS'] = '{not json'
      expect(() => getPythonChecksums()).toThrow(/Python.*not valid JSON/)
    })
  })

  describe('requirePythonChecksum', () => {
    it('returns undefined in dev mode (empty checksums)', () => {
      delete process.env['INLINED_PYTHON_CHECKSUMS']
      expect(requirePythonChecksum('python-3.12.tar.gz')).toBeUndefined()
    })

    it('returns checksum for a known asset', () => {
      process.env['INLINED_PYTHON_CHECKSUMS'] = JSON.stringify({
        'python-3.12.tar.gz': 'abc123',
      })
      expect(requirePythonChecksum('python-3.12.tar.gz')).toBe('abc123')
    })

    it('throws for unknown asset in production mode', () => {
      process.env['INLINED_PYTHON_CHECKSUMS'] = JSON.stringify({
        'python-3.12.tar.gz': 'abc123',
      })
      expect(() => requirePythonChecksum('python-3.99.tar.gz')).toThrow(
        /Python has no SHA-256 checksum/,
      )
    })
  })
})
