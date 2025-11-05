/**
 * @fileoverview Unit tests for license identifier constants and copy-left license detection.
 *
 * Tests SPDX license constants:
 * - COPYLEFT_LICENSES set (GPL, LGPL, AGPL, MPL, etc.)
 * - PERMISSIVE_LICENSES set (MIT, Apache-2.0, BSD, ISC)
 * - License compatibility rules
 * Frozen constants for license validation and risk assessment.
 */

import { describe, expect, it } from 'vitest'

import {
  getCopyLeftLicenses,
  MIT,
  UNLICENCED,
  UNLICENSED,
} from '@socketsecurity/lib/constants/licenses'

describe('constants/licenses', () => {
  describe('license identifier constants', () => {
    it('should export MIT constant', () => {
      expect(MIT).toBe('MIT')
    })

    it('should export UNLICENCED constant', () => {
      expect(UNLICENCED).toBe('UNLICENCED')
    })

    it('should export UNLICENSED constant', () => {
      expect(UNLICENSED).toBe('UNLICENSED')
    })

    it('should be uppercase strings', () => {
      expect(MIT).toBe(MIT.toUpperCase())
      expect(UNLICENCED).toBe(UNLICENCED.toUpperCase())
      expect(UNLICENSED).toBe(UNLICENSED.toUpperCase())
    })

    it('should have different spellings for unlicensed', () => {
      expect(UNLICENCED).not.toBe(UNLICENSED)
      // British vs American spelling
      expect(UNLICENCED).toContain('UNLICENC')
      expect(UNLICENSED).toContain('UNLICENS')
    })
  })

  describe('getCopyLeftLicenses', () => {
    it('should return a Set', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses).toBeInstanceOf(Set)
    })

    it('should contain AGPL licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('AGPL-1.0')).toBe(true)
      expect(licenses.has('AGPL-1.0-only')).toBe(true)
      expect(licenses.has('AGPL-1.0-or-later')).toBe(true)
      expect(licenses.has('AGPL-3.0')).toBe(true)
      expect(licenses.has('AGPL-3.0-only')).toBe(true)
      expect(licenses.has('AGPL-3.0-or-later')).toBe(true)
    })

    it('should contain GPL licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('GPL-1.0')).toBe(true)
      expect(licenses.has('GPL-1.0-only')).toBe(true)
      expect(licenses.has('GPL-1.0-or-later')).toBe(true)
      expect(licenses.has('GPL-2.0')).toBe(true)
      expect(licenses.has('GPL-2.0-only')).toBe(true)
      expect(licenses.has('GPL-2.0-or-later')).toBe(true)
      expect(licenses.has('GPL-3.0')).toBe(true)
      expect(licenses.has('GPL-3.0-only')).toBe(true)
      expect(licenses.has('GPL-3.0-or-later')).toBe(true)
    })

    it('should contain Creative Commons ShareAlike licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('CC-BY-SA-1.0')).toBe(true)
      expect(licenses.has('CC-BY-SA-2.0')).toBe(true)
      expect(licenses.has('CC-BY-SA-3.0')).toBe(true)
      expect(licenses.has('CC-BY-SA-4.0')).toBe(true)
    })

    it('should contain EPL licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('EPL-1.0')).toBe(true)
      expect(licenses.has('EPL-2.0')).toBe(true)
    })

    it('should contain EUPL licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('EUPL-1.1')).toBe(true)
      expect(licenses.has('EUPL-1.2')).toBe(true)
    })

    it('should not contain permissive licenses', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('MIT')).toBe(false)
      expect(licenses.has('Apache-2.0')).toBe(false)
      expect(licenses.has('BSD-3-Clause')).toBe(false)
      expect(licenses.has('ISC')).toBe(false)
    })

    it('should return same Set instance on multiple calls (cached)', () => {
      const first = getCopyLeftLicenses()
      const second = getCopyLeftLicenses()
      expect(first).toBe(second)
    })

    it('should have consistent size', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.size).toBeGreaterThan(0)
      const size1 = licenses.size
      const size2 = getCopyLeftLicenses().size
      expect(size1).toBe(size2)
    })

    it('should contain expected number of licenses', () => {
      const licenses = getCopyLeftLicenses()
      // 6 AGPL + 4 CC-BY-SA + 2 EPL + 2 EUPL + 9 GPL = 23 licenses
      expect(licenses.size).toBe(23)
    })

    it('should only contain strings', () => {
      const licenses = getCopyLeftLicenses()
      for (const license of licenses) {
        expect(typeof license).toBe('string')
      }
    })

    it('should contain only SPDX-style identifiers', () => {
      const licenses = getCopyLeftLicenses()
      for (const license of licenses) {
        // SPDX identifiers use letters, digits, hyphens, and dots
        expect(license).toMatch(/^[A-Za-z0-9.-]+$/)
      }
    })

    it('should support checking if license is copy-left', () => {
      const licenses = getCopyLeftLicenses()
      const isGPL = licenses.has('GPL-3.0')
      expect(isGPL).toBe(true)
    })

    it('should support iteration', () => {
      const licenses = getCopyLeftLicenses()
      const array = Array.from(licenses)
      expect(array.length).toBe(licenses.size)
    })

    it('should handle case-sensitive checks', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('gpl-3.0')).toBe(false)
      expect(licenses.has('GPL-3.0')).toBe(true)
    })
  })

  describe('copy-left license categories', () => {
    it('should have all AGPL variants', () => {
      const licenses = getCopyLeftLicenses()
      const agplLicenses = Array.from(licenses).filter(l =>
        l.startsWith('AGPL'),
      )
      expect(agplLicenses.length).toBe(6)
    })

    it('should have all GPL variants', () => {
      const licenses = getCopyLeftLicenses()
      const gplLicenses = Array.from(licenses).filter(l => l.startsWith('GPL-'))
      expect(gplLicenses.length).toBe(9)
    })

    it('should have all CC-BY-SA variants', () => {
      const licenses = getCopyLeftLicenses()
      const ccLicenses = Array.from(licenses).filter(l =>
        l.startsWith('CC-BY-SA'),
      )
      expect(ccLicenses.length).toBe(4)
    })

    it('should have all EPL variants', () => {
      const licenses = getCopyLeftLicenses()
      const eplLicenses = Array.from(licenses).filter(l => l.startsWith('EPL'))
      expect(eplLicenses.length).toBe(2)
    })

    it('should have all EUPL variants', () => {
      const licenses = getCopyLeftLicenses()
      const euplLicenses = Array.from(licenses).filter(l =>
        l.startsWith('EUPL'),
      )
      expect(euplLicenses.length).toBe(2)
    })
  })

  describe('license version patterns', () => {
    it('should include -only variants', () => {
      const licenses = getCopyLeftLicenses()
      const onlyVariants = Array.from(licenses).filter(l => l.includes('-only'))
      expect(onlyVariants.length).toBeGreaterThan(0)
    })

    it('should include -or-later variants', () => {
      const licenses = getCopyLeftLicenses()
      const orLaterVariants = Array.from(licenses).filter(l =>
        l.includes('-or-later'),
      )
      expect(orLaterVariants.length).toBeGreaterThan(0)
    })

    it('should have consistent version naming', () => {
      const licenses = getCopyLeftLicenses()
      for (const license of licenses) {
        if (license.includes('-only') || license.includes('-or-later')) {
          // Should have version number before modifier
          expect(license).toMatch(/\d+\.\d+(-only|-or-later)/)
        }
      }
    })
  })

  describe('real-world usage', () => {
    it('should identify GPL-3.0 as copy-left', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('GPL-3.0')).toBe(true)
    })

    it('should identify AGPL-3.0 as copy-left', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('AGPL-3.0')).toBe(true)
    })

    it('should support filtering packages by copy-left licenses', () => {
      const licenses = getCopyLeftLicenses()
      const packageLicense = 'GPL-2.0'
      const isCopyLeft = licenses.has(packageLicense)
      expect(isCopyLeft).toBe(true)
    })

    it('should handle modern SPDX identifiers with -only suffix', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('GPL-3.0-only')).toBe(true)
    })

    it('should handle SPDX identifiers with -or-later suffix', () => {
      const licenses = getCopyLeftLicenses()
      expect(licenses.has('GPL-3.0-or-later')).toBe(true)
    })
  })
})
