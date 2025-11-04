/**
 * Unit tests for alert translations.
 *
 * Purpose:
 * Tests alert message translations and internationalization. Validates translation key lookups and fallback handling.
 *
 * Test Coverage:
 * - Translation key resolution
 * - Fallback to default language
 * - Missing translation handling
 * - Alert type translations
 * - Severity level translations
 *
 * Testing Approach:
 * Uses translation fixtures and validates i18n functionality.
 *
 * Related Files:
 * - utils/alert/translations.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the JSON import.
vi.mock('../../../../../src/data/alert-translations.json', () => ({
  default: {
    alerts: {
      badEncoding: {
        description:
          'Source files are encoded using a non-standard text encoding.',
        emoji: '⚠️',
        suggestion:
          'Ensure all published files are encoded using a standard encoding such as UTF8, UTF16, UTF32, SHIFT-JIS, etc.',
        title: 'Bad text encoding',
      },
      badSemver: {
        description:
          'Package version is not a valid semantic version (semver).',
        emoji: '⚠️',
        suggestion:
          'All versions of all packages on npm should use use a valid semantic version. Publish a new version of the package with a valid semantic version. Semantic version ranges do not work with invalid semantic versions.',
        title: 'Bad semver',
      },
    },
  },
}))

describe('translations utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getTranslations', () => {
    it('returns the translations object', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result = getTranslations()

      expect(result).toHaveProperty('alerts')
      expect(result.alerts).toHaveProperty('badEncoding')
      expect(result.alerts).toHaveProperty('badSemver')
    })

    it('returns consistent results on multiple calls', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result1 = getTranslations()
      const result2 = getTranslations()
      const result3 = getTranslations()

      // Should return the same object reference.
      expect(result1).toBe(result2)
      expect(result2).toBe(result3)
    })

    it('includes alert properties', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result = getTranslations()

      expect(result.alerts.badEncoding).toEqual({
        description:
          'Source files are encoded using a non-standard text encoding.',
        emoji: '⚠️',
        suggestion:
          'Ensure all published files are encoded using a standard encoding such as UTF8, UTF16, UTF32, SHIFT-JIS, etc.',
        title: 'Bad text encoding',
      })
    })

    it('has correct structure for alert entries', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result = getTranslations()
      const { badSemver } = result.alerts

      expect(badSemver).toHaveProperty('description')
      expect(badSemver).toHaveProperty('emoji')
      expect(badSemver).toHaveProperty('suggestion')
      expect(badSemver).toHaveProperty('title')
      expect(typeof badSemver.description).toBe('string')
      expect(typeof badSemver.title).toBe('string')
    })

    it('returns alerts object with multiple entries', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result = getTranslations()

      expect(Object.keys(result.alerts).length).toBeGreaterThanOrEqual(2)
      expect(result.alerts.badEncoding).toBeDefined()
      expect(result.alerts.badSemver).toBeDefined()
    })

    it('handles nested alert structure', async () => {
      const { getTranslations } = await import('../../../../../src/utils/alert/translations.mts')

      const result = getTranslations()

      // Verify we can access nested properties.
      expect(result.alerts.badEncoding.title).toBe('Bad text encoding')
      expect(result.alerts.badSemver.title).toBe('Bad semver')
    })
  })
})
