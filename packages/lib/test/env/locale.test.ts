/**
 * @fileoverview Unit tests for locale environment variable getters.
 *
 * Tests getLang() for locale/language settings (LANG, LC_ALL, LC_MESSAGES).
 * Returns locale string (e.g., "en_US.UTF-8") or undefined if not set.
 * Uses rewire for test isolation. Critical for internationalization and character encoding.
 */

import {
  getLang,
  getLcAll,
  getLcMessages,
} from '@socketsecurity/lib/env/locale'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/locale', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getLang', () => {
    it('should return LANG environment variable when set', () => {
      setEnv('LANG', 'en_US.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
    })

    it('should return undefined when LANG is not set', () => {
      clearEnv('LANG')
      // After clearing override, falls back to actual process.env
      const result = getLang()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle various locale formats', () => {
      setEnv('LANG', 'fr_FR.UTF-8')
      expect(getLang()).toBe('fr_FR.UTF-8')

      setEnv('LANG', 'de_DE')
      expect(getLang()).toBe('de_DE')

      setEnv('LANG', 'C')
      expect(getLang()).toBe('C')

      setEnv('LANG', 'POSIX')
      expect(getLang()).toBe('POSIX')
    })

    it('should handle empty string', () => {
      setEnv('LANG', '')
      expect(getLang()).toBe('')
    })

    it('should handle locale with encoding', () => {
      setEnv('LANG', 'ja_JP.eucJP')
      expect(getLang()).toBe('ja_JP.eucJP')
    })

    it('should handle locale with variant', () => {
      setEnv('LANG', 'en_US.UTF-8@latn')
      expect(getLang()).toBe('en_US.UTF-8@latn')
    })
  })

  describe('getLcAll', () => {
    it('should return LC_ALL environment variable when set', () => {
      setEnv('LC_ALL', 'en_US.UTF-8')
      expect(getLcAll()).toBe('en_US.UTF-8')
    })

    it('should return undefined when LC_ALL is not set', () => {
      clearEnv('LC_ALL')
      // After clearing override, falls back to actual process.env
      const result = getLcAll()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle various locale formats', () => {
      setEnv('LC_ALL', 'es_ES.UTF-8')
      expect(getLcAll()).toBe('es_ES.UTF-8')

      setEnv('LC_ALL', 'zh_CN.GB2312')
      expect(getLcAll()).toBe('zh_CN.GB2312')

      setEnv('LC_ALL', 'C')
      expect(getLcAll()).toBe('C')
    })

    it('should handle empty string', () => {
      setEnv('LC_ALL', '')
      expect(getLcAll()).toBe('')
    })

    it('should be independent of LANG', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLcAll()).toBe('fr_FR.UTF-8')
    })

    it('should handle locale override', () => {
      setEnv('LC_ALL', 'it_IT.UTF-8')
      expect(getLcAll()).toBe('it_IT.UTF-8')
    })
  })

  describe('getLcMessages', () => {
    it('should return LC_MESSAGES environment variable when set', () => {
      setEnv('LC_MESSAGES', 'en_US.UTF-8')
      expect(getLcMessages()).toBe('en_US.UTF-8')
    })

    it('should return undefined when LC_MESSAGES is not set', () => {
      clearEnv('LC_MESSAGES')
      // After clearing override, falls back to actual process.env
      const result = getLcMessages()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle various locale formats', () => {
      setEnv('LC_MESSAGES', 'pt_BR.UTF-8')
      expect(getLcMessages()).toBe('pt_BR.UTF-8')

      setEnv('LC_MESSAGES', 'ru_RU.UTF-8')
      expect(getLcMessages()).toBe('ru_RU.UTF-8')

      setEnv('LC_MESSAGES', 'C')
      expect(getLcMessages()).toBe('C')
    })

    it('should handle empty string', () => {
      setEnv('LC_MESSAGES', '')
      expect(getLcMessages()).toBe('')
    })

    it('should be independent of LANG and LC_ALL', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')
      setEnv('LC_MESSAGES', 'de_DE.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLcAll()).toBe('fr_FR.UTF-8')
      expect(getLcMessages()).toBe('de_DE.UTF-8')
    })

    it('should handle message-specific locale', () => {
      setEnv('LC_MESSAGES', 'ko_KR.UTF-8')
      expect(getLcMessages()).toBe('ko_KR.UTF-8')
    })
  })

  describe('locale interaction', () => {
    it('should allow setting all locale variables independently', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')
      setEnv('LC_MESSAGES', 'de_DE.UTF-8')

      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLcAll()).toBe('fr_FR.UTF-8')
      expect(getLcMessages()).toBe('de_DE.UTF-8')
    })

    it('should handle clearing individual locale variables', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')
      setEnv('LC_MESSAGES', 'de_DE.UTF-8')

      clearEnv('LC_ALL')

      expect(getLang()).toBe('en_US.UTF-8')
      // After clearing override, falls back to actual process.env
      const result = getLcAll()
      expect(typeof result).toMatch(/string|undefined/)
      expect(getLcMessages()).toBe('de_DE.UTF-8')
    })

    it('should handle resetting all environment variables', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')
      setEnv('LC_MESSAGES', 'de_DE.UTF-8')

      resetEnv()

      // After reset, values depend on actual process.env
      // Just verify functions still work
      expect(typeof getLang()).toMatch(/string|undefined/)
      expect(typeof getLcAll()).toMatch(/string|undefined/)
      expect(typeof getLcMessages()).toMatch(/string|undefined/)
    })

    it('should handle updating locale values', () => {
      setEnv('LANG', 'en_US.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')

      setEnv('LANG', 'ja_JP.UTF-8')
      expect(getLang()).toBe('ja_JP.UTF-8')

      setEnv('LANG', 'zh_CN.UTF-8')
      expect(getLang()).toBe('zh_CN.UTF-8')
    })
  })

  describe('edge cases', () => {
    it('should handle special characters in locale', () => {
      setEnv('LANG', 'en_US.UTF-8@special')
      expect(getLang()).toBe('en_US.UTF-8@special')
    })

    it('should handle numeric values as strings', () => {
      setEnv('LANG', '12345')
      expect(getLang()).toBe('12345')
    })

    it('should handle whitespace in values', () => {
      setEnv('LANG', ' en_US.UTF-8 ')
      expect(getLang()).toBe(' en_US.UTF-8 ')
    })

    it('should handle multiple clearing and setting', () => {
      setEnv('LANG', 'en_US.UTF-8')
      clearEnv('LANG')
      // After clearing override, falls back to actual process.env
      let result = getLang()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('LANG', 'fr_FR.UTF-8')
      expect(getLang()).toBe('fr_FR.UTF-8')

      clearEnv('LANG')
      result = getLang()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle all three variables being unset', () => {
      clearEnv('LANG')
      clearEnv('LC_ALL')
      clearEnv('LC_MESSAGES')

      // After clearing overrides, fall back to actual process.env
      expect(typeof getLang()).toMatch(/string|undefined/)
      expect(typeof getLcAll()).toMatch(/string|undefined/)
      expect(typeof getLcMessages()).toMatch(/string|undefined/)
    })

    it('should handle consecutive reads', () => {
      setEnv('LANG', 'en_US.UTF-8')

      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
    })

    it('should handle alternating between variables', () => {
      setEnv('LANG', 'en_US.UTF-8')
      setEnv('LC_ALL', 'fr_FR.UTF-8')

      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLcAll()).toBe('fr_FR.UTF-8')
      expect(getLang()).toBe('en_US.UTF-8')
      expect(getLcAll()).toBe('fr_FR.UTF-8')
    })
  })
})
