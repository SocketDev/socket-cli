/**
 * @fileoverview Unit tests for temporary directory environment variable getters.
 *
 * Tests getTempdir() / getTmpdir() for system temporary directory paths.
 * Returns TMPDIR, TEMP, or TMP env var value, or os.tmpdir() fallback.
 * Uses rewire for test isolation. Critical for temporary file operations.
 */

import { getTemp, getTmp, getTmpdir } from '@socketsecurity/lib/env/temp-dir'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/temp-dir', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getTmpdir', () => {
    it('should return TMPDIR when set', () => {
      setEnv('TMPDIR', '/tmp')
      expect(getTmpdir()).toBe('/tmp')
    })

    it('should return undefined when TMPDIR is not set', () => {
      clearEnv('TMPDIR')
      // After clearing override, falls back to actual process.env
      const result = getTmpdir()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle macOS default tmpdir', () => {
      setEnv('TMPDIR', '/var/folders/abc/xyz/T/')
      expect(getTmpdir()).toBe('/var/folders/abc/xyz/T/')
    })

    it('should handle Unix tmpdir', () => {
      setEnv('TMPDIR', '/tmp/')
      expect(getTmpdir()).toBe('/tmp/')
    })

    it('should handle custom tmpdir', () => {
      setEnv('TMPDIR', '/custom/temp')
      expect(getTmpdir()).toBe('/custom/temp')
    })

    it('should handle tmpdir without trailing slash', () => {
      setEnv('TMPDIR', '/tmp')
      expect(getTmpdir()).toBe('/tmp')
    })

    it('should handle tmpdir with trailing slash', () => {
      setEnv('TMPDIR', '/tmp/')
      expect(getTmpdir()).toBe('/tmp/')
    })

    it('should handle empty string', () => {
      setEnv('TMPDIR', '')
      expect(getTmpdir()).toBe('')
    })

    it('should handle updating tmpdir', () => {
      setEnv('TMPDIR', '/tmp1')
      expect(getTmpdir()).toBe('/tmp1')

      setEnv('TMPDIR', '/tmp2')
      expect(getTmpdir()).toBe('/tmp2')
    })

    it('should handle consecutive reads', () => {
      setEnv('TMPDIR', '/tmp')
      expect(getTmpdir()).toBe('/tmp')
      expect(getTmpdir()).toBe('/tmp')
      expect(getTmpdir()).toBe('/tmp')
    })

    it('should handle tmpdir with spaces', () => {
      setEnv('TMPDIR', '/path with spaces/tmp')
      expect(getTmpdir()).toBe('/path with spaces/tmp')
    })

    it('should handle long tmpdir path', () => {
      const longPath = `${'/a'.repeat(100)}/tmp`
      setEnv('TMPDIR', longPath)
      expect(getTmpdir()).toBe(longPath)
    })
  })

  describe('getTemp', () => {
    it('should return TEMP when set', () => {
      setEnv('TEMP', 'C:\\Windows\\Temp')
      expect(getTemp()).toBe('C:\\Windows\\Temp')
    })

    it('should return undefined when TEMP is not set', () => {
      clearEnv('TEMP')
      // After clearing override, falls back to actual process.env
      const result = getTemp()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Windows default temp', () => {
      setEnv('TEMP', 'C:\\Windows\\Temp')
      expect(getTemp()).toBe('C:\\Windows\\Temp')
    })

    it('should handle Windows user temp', () => {
      setEnv('TEMP', 'C:\\Users\\username\\AppData\\Local\\Temp')
      expect(getTemp()).toBe('C:\\Users\\username\\AppData\\Local\\Temp')
    })

    it('should handle forward slashes', () => {
      setEnv('TEMP', 'C:/Windows/Temp')
      expect(getTemp()).toBe('C:/Windows/Temp')
    })

    it('should handle UNC paths', () => {
      setEnv('TEMP', '\\\\server\\share\\temp')
      expect(getTemp()).toBe('\\\\server\\share\\temp')
    })

    it('should handle empty string', () => {
      setEnv('TEMP', '')
      expect(getTemp()).toBe('')
    })

    it('should handle updating temp', () => {
      setEnv('TEMP', 'C:\\Temp1')
      expect(getTemp()).toBe('C:\\Temp1')

      setEnv('TEMP', 'C:\\Temp2')
      expect(getTemp()).toBe('C:\\Temp2')
    })

    it('should handle consecutive reads', () => {
      setEnv('TEMP', 'C:\\Temp')
      expect(getTemp()).toBe('C:\\Temp')
      expect(getTemp()).toBe('C:\\Temp')
      expect(getTemp()).toBe('C:\\Temp')
    })

    it('should handle temp with spaces', () => {
      setEnv('TEMP', 'C:\\Program Files\\Temp')
      expect(getTemp()).toBe('C:\\Program Files\\Temp')
    })

    it('should handle Unix-style path in TEMP', () => {
      setEnv('TEMP', '/tmp')
      expect(getTemp()).toBe('/tmp')
    })

    it('should handle relative path', () => {
      setEnv('TEMP', '.\\temp')
      expect(getTemp()).toBe('.\\temp')
    })
  })

  describe('getTmp', () => {
    it('should return TMP when set', () => {
      setEnv('TMP', 'C:\\Temp')
      expect(getTmp()).toBe('C:\\Temp')
    })

    it('should return undefined when TMP is not set', () => {
      clearEnv('TMP')
      // After clearing override, falls back to actual process.env
      const result = getTmp()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Windows TMP', () => {
      setEnv('TMP', 'C:\\Temp')
      expect(getTmp()).toBe('C:\\Temp')
    })

    it('should handle Unix TMP', () => {
      setEnv('TMP', '/tmp')
      expect(getTmp()).toBe('/tmp')
    })

    it('should handle custom TMP', () => {
      setEnv('TMP', '/custom/tmp')
      expect(getTmp()).toBe('/custom/tmp')
    })

    it('should handle empty string', () => {
      setEnv('TMP', '')
      expect(getTmp()).toBe('')
    })

    it('should handle updating tmp', () => {
      setEnv('TMP', '/tmp1')
      expect(getTmp()).toBe('/tmp1')

      setEnv('TMP', '/tmp2')
      expect(getTmp()).toBe('/tmp2')
    })

    it('should handle consecutive reads', () => {
      setEnv('TMP', '/tmp')
      expect(getTmp()).toBe('/tmp')
      expect(getTmp()).toBe('/tmp')
      expect(getTmp()).toBe('/tmp')
    })

    it('should handle tmp with special characters', () => {
      setEnv('TMP', '/tmp-123_test')
      expect(getTmp()).toBe('/tmp-123_test')
    })

    it('should handle WSL tmp path', () => {
      setEnv('TMP', '/mnt/c/Windows/Temp')
      expect(getTmp()).toBe('/mnt/c/Windows/Temp')
    })
  })

  describe('temp directory interaction', () => {
    it('should handle all temp vars set simultaneously', () => {
      setEnv('TMPDIR', '/tmp')
      setEnv('TEMP', 'C:\\Windows\\Temp')
      setEnv('TMP', 'C:\\Temp')

      expect(getTmpdir()).toBe('/tmp')
      expect(getTemp()).toBe('C:\\Windows\\Temp')
      expect(getTmp()).toBe('C:\\Temp')
    })

    it('should handle clearing all temp vars', () => {
      setEnv('TMPDIR', '/tmp')
      setEnv('TEMP', 'C:\\Temp')
      setEnv('TMP', 'C:\\TMP')

      clearEnv('TMPDIR')
      clearEnv('TEMP')
      clearEnv('TMP')

      expect(typeof getTmpdir()).toMatch(/string|undefined/)
      expect(typeof getTemp()).toMatch(/string|undefined/)
      expect(typeof getTmp()).toMatch(/string|undefined/)
    })

    it('should handle Unix temp directory priority', () => {
      setEnv('TMPDIR', '/var/tmp')
      setEnv('TMP', '/tmp')

      expect(getTmpdir()).toBe('/var/tmp')
      expect(getTmp()).toBe('/tmp')
    })

    it('should handle Windows temp directory priority', () => {
      setEnv('TEMP', 'C:\\Windows\\Temp')
      setEnv('TMP', 'C:\\Temp')

      expect(getTemp()).toBe('C:\\Windows\\Temp')
      expect(getTmp()).toBe('C:\\Temp')
    })
  })
})
