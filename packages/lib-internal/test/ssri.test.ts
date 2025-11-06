/**
 * @fileoverview Unit tests for Subresource Integrity (SSRI) hash utilities.
 *
 * Tests SSRI (Subresource Integrity) hash format utilities:
 * - ssriToHex() converts SSRI format to hex string
 * - hexToSsri() converts hex string to SSRI format
 * - parseSsri() parses SSRI strings into components
 * - isValidSsri() validates SSRI format strings
 * - isValidHex() validates hex hash strings
 * - Supports sha256, sha384, sha512 algorithms
 * Used by Socket tools for package integrity verification.
 */

import {
  hexToSsri,
  isValidHex,
  isValidSsri,
  parseSsri,
  ssriToHex,
} from '@socketsecurity/lib/ssri'
import { describe, expect, it } from 'vitest'

describe('ssri', () => {
  describe('ssriToHex', () => {
    it('should convert sha256 SSRI to hex', () => {
      const ssri = 'sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY='
      const hex = ssriToHex(ssri)
      expect(hex).toBe(
        '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856',
      )
    })

    it('should convert sha512 SSRI to hex', () => {
      const ssri = 'sha512-AAAA'
      const hex = ssriToHex(ssri)
      expect(hex.length).toBeGreaterThan(0)
    })

    it('should handle different algorithms', () => {
      const ssri = 'sha1-qUqP5cyxm6YcTAhz05Hph5gvu9M='
      const hex = ssriToHex(ssri)
      expect(hex).toBe('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')
    })

    it('should throw on invalid SSRI format', () => {
      expect(() => ssriToHex('invalid')).toThrow('Invalid SSRI format')
    })

    it('should throw on missing algorithm', () => {
      expect(() => ssriToHex('-AAAA')).toThrow('Invalid SSRI format')
    })

    it('should throw on missing hash', () => {
      expect(() => ssriToHex('sha256-')).toThrow('Invalid SSRI format')
    })

    it('should throw on hash too short', () => {
      expect(() => ssriToHex('sha256-A')).toThrow('Invalid SSRI format')
    })

    it('should handle uppercase algorithm names', () => {
      const ssri = 'SHA256-AAAA'
      const hex = ssriToHex(ssri)
      expect(hex.length).toBeGreaterThan(0)
    })

    it('should handle mixed case', () => {
      const ssri = 'Sha256-AAAA'
      const hex = ssriToHex(ssri)
      expect(hex.length).toBeGreaterThan(0)
    })
  })

  describe('hexToSsri', () => {
    it('should convert hex to sha256 SSRI', () => {
      const hex =
        '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856'
      const ssri = hexToSsri(hex)
      expect(ssri).toBe('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=')
    })

    it('should use default algorithm sha256', () => {
      const hex = 'abcd1234'
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })

    it('should accept custom algorithm', () => {
      const hex = 'abcd1234'
      const ssri = hexToSsri(hex, 'sha512')
      expect(ssri).toMatch(/^sha512-/)
    })

    it('should throw on invalid hex format', () => {
      expect(() => hexToSsri('not-hex-format')).toThrow('Invalid hex format')
    })

    it('should throw on invalid characters', () => {
      expect(() => hexToSsri('ghijklmn')).toThrow('Invalid hex format')
    })

    it('should handle uppercase hex', () => {
      const hex = 'ABCD1234'
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })

    it('should handle mixed case hex', () => {
      const hex = 'AbCd1234'
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })

    it('should handle short hex values', () => {
      const hex = 'ab'
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })

    it('should handle long hex values', () => {
      const hex = 'a'.repeat(128)
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })
  })

  describe('isValidSsri', () => {
    it('should validate correct sha256 SSRI', () => {
      expect(
        isValidSsri('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY='),
      ).toBe(true)
    })

    it('should validate correct sha512 SSRI', () => {
      expect(isValidSsri('sha512-AAAA')).toBe(true)
    })

    it('should validate with padding', () => {
      expect(isValidSsri('sha256-AAAA==')).toBe(true)
    })

    it('should validate without padding', () => {
      expect(isValidSsri('sha256-AAAA')).toBe(true)
    })

    it('should validate different algorithms', () => {
      expect(isValidSsri('sha1-qUqP5cyxm6YcTAhz05Hph5gvu9M=')).toBe(true)
      expect(isValidSsri('md5-rL0Y20zC+Fzt72VPzMSk2A==')).toBe(true)
    })

    it('should validate uppercase algorithms', () => {
      expect(isValidSsri('SHA256-AAAA')).toBe(true)
    })

    it('should invalidate plain hex', () => {
      expect(
        isValidSsri(
          '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856',
        ),
      ).toBe(false)
    })

    it('should invalidate missing algorithm', () => {
      expect(isValidSsri('-AAAA')).toBe(false)
    })

    it('should invalidate missing hash', () => {
      expect(isValidSsri('sha256-')).toBe(false)
    })

    it('should invalidate hash too short', () => {
      expect(isValidSsri('sha256-A')).toBe(false)
    })

    it('should invalidate empty string', () => {
      expect(isValidSsri('')).toBe(false)
    })

    it('should invalidate no dash separator', () => {
      expect(isValidSsri('sha256AAAA')).toBe(false)
    })

    it('should handle base64 special characters', () => {
      expect(isValidSsri('sha256-A+B/C==')).toBe(true)
    })
  })

  describe('isValidHex', () => {
    it('should validate lowercase hex', () => {
      expect(isValidHex('abcdef0123456789')).toBe(true)
    })

    it('should validate uppercase hex', () => {
      expect(isValidHex('ABCDEF0123456789')).toBe(true)
    })

    it('should validate mixed case hex', () => {
      expect(isValidHex('AbCdEf0123456789')).toBe(true)
    })

    it('should validate short hex', () => {
      expect(isValidHex('ab')).toBe(true)
    })

    it('should validate long hex', () => {
      expect(isValidHex('a'.repeat(128))).toBe(true)
    })

    it('should invalidate SSRI format', () => {
      expect(
        isValidHex('sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY='),
      ).toBe(false)
    })

    it('should invalidate non-hex characters', () => {
      expect(isValidHex('ghijklmn')).toBe(false)
    })

    it('should invalidate special characters', () => {
      expect(isValidHex('abcd-efgh')).toBe(false)
    })

    it('should invalidate empty string', () => {
      expect(isValidHex('')).toBe(false)
    })

    it('should invalidate spaces', () => {
      expect(isValidHex('ab cd')).toBe(false)
    })

    it('should invalidate base64', () => {
      expect(isValidHex('AAAA+BBB/CCC=')).toBe(false)
    })
  })

  describe('parseSsri', () => {
    it('should parse sha256 SSRI', () => {
      const result = parseSsri(
        'sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=',
      )
      expect(result.algorithm).toBe('sha256')
      expect(result.base64Hash).toBe(
        'dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY=',
      )
    })

    it('should parse sha512 SSRI', () => {
      const result = parseSsri('sha512-AAAA')
      expect(result.algorithm).toBe('sha512')
      expect(result.base64Hash).toBe('AAAA')
    })

    it('should parse sha1 SSRI', () => {
      const result = parseSsri('sha1-qUqP5cyxm6YcTAhz05Hph5gvu9M=')
      expect(result.algorithm).toBe('sha1')
      expect(result.base64Hash).toBe('qUqP5cyxm6YcTAhz05Hph5gvu9M=')
    })

    it('should handle uppercase algorithm', () => {
      const result = parseSsri('SHA256-AAAA')
      expect(result.algorithm).toBe('SHA256')
      expect(result.base64Hash).toBe('AAAA')
    })

    it('should handle mixed case algorithm', () => {
      const result = parseSsri('Sha256-AAAA')
      expect(result.algorithm).toBe('Sha256')
    })

    it('should throw on invalid format', () => {
      expect(() => parseSsri('invalid')).toThrow('Invalid SSRI format')
    })

    it('should throw on missing algorithm', () => {
      expect(() => parseSsri('-AAAA')).toThrow('Invalid SSRI format')
    })

    it('should throw on missing hash', () => {
      expect(() => parseSsri('sha256-')).toThrow('Invalid SSRI format')
    })

    it('should throw on hash too short', () => {
      expect(() => parseSsri('sha256-A')).toThrow('Invalid SSRI format')
    })

    it('should throw on empty string', () => {
      expect(() => parseSsri('')).toThrow('Invalid SSRI format')
    })

    it('should handle base64 padding', () => {
      const result = parseSsri('sha256-AAAA==')
      expect(result.base64Hash).toBe('AAAA==')
    })

    it('should handle base64 special chars', () => {
      const result = parseSsri('sha256-A+B/C=')
      expect(result.base64Hash).toBe('A+B/C=')
    })
  })

  describe('roundtrip conversion', () => {
    it('should roundtrip hex to SSRI and back', () => {
      const originalHex =
        '76682a9fc3bbe62975176e2541f39a8168877d828d5cad8b56461fc36ac2b856'
      const ssri = hexToSsri(originalHex)
      const hex = ssriToHex(ssri)
      expect(hex).toBe(originalHex)
    })

    it('should roundtrip SSRI to hex and back', () => {
      const originalSsri = 'sha256-dmgqn8O75il1F24lQfOagWiHfYKNXK2LVkYfw2rCuFY='
      const hex = ssriToHex(originalSsri)
      const ssri = hexToSsri(hex)
      expect(ssri).toBe(originalSsri)
    })

    it('should roundtrip with different algorithms', () => {
      const hex = 'abcdef0123456789'
      const ssri512 = hexToSsri(hex, 'sha512')
      expect(ssri512).toMatch(/^sha512-/)
    })

    it('should preserve hash value through conversions', () => {
      const hex1 = 'a1b2c3d4'
      const ssri = hexToSsri(hex1)
      const hex2 = ssriToHex(ssri)
      expect(hex1).toBe(hex2)
    })
  })

  describe('edge cases', () => {
    it('should handle minimal valid SSRI', () => {
      const ssri = 'a-AA'
      expect(isValidSsri(ssri)).toBe(true)
      const parsed = parseSsri(ssri)
      expect(parsed.algorithm).toBe('a')
      expect(parsed.base64Hash).toBe('AA')
    })

    it('should handle minimal valid hex', () => {
      const hex = 'a'
      expect(isValidHex(hex)).toBe(true)
      const ssri = hexToSsri(hex)
      expect(ssri).toMatch(/^sha256-/)
    })

    it('should handle very long hashes', () => {
      const longHex = 'a'.repeat(256)
      const ssri = hexToSsri(longHex)
      const hexBack = ssriToHex(ssri)
      expect(hexBack).toBe(longHex)
    })

    it('should handle numeric algorithm names', () => {
      const ssri = 'sha3-AAAA'
      expect(isValidSsri(ssri)).toBe(true)
    })

    it('should handle alphanumeric algorithm names', () => {
      const ssri = 'blake2b-AAAA'
      expect(isValidSsri(ssri)).toBe(true)
    })
  })

  describe('integration', () => {
    it('should work with real world hashes', () => {
      // Real world sha256 hash
      const hex =
        '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'
      const ssri = hexToSsri(hex)
      expect(isValidSsri(ssri)).toBe(true)
      expect(ssriToHex(ssri)).toBe(hex)
    })

    it('should validate before parsing', () => {
      const ssri = 'sha256-AAAA'
      if (isValidSsri(ssri)) {
        const parsed = parseSsri(ssri)
        expect(parsed.algorithm).toBe('sha256')
      }
    })

    it('should validate hex before converting', () => {
      const hex = 'abcd1234'
      if (isValidHex(hex)) {
        const ssri = hexToSsri(hex)
        expect(isValidSsri(ssri)).toBe(true)
      }
    })
  })
})
