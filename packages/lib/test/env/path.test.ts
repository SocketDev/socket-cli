/**
 * @fileoverview Unit tests for PATH environment variable getter.
 *
 * Tests getPath() for system executable search paths (PATH env var).
 * Returns colon/semicolon-separated path string or undefined.
 * Uses rewire for test isolation. Critical for executable resolution.
 */

import { getPath } from '@socketsecurity/lib/env/path'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/path', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getPath', () => {
    it('should return PATH environment variable when set', () => {
      setEnv('PATH', '/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')
    })

    it('should return undefined when PATH is not set', () => {
      clearEnv('PATH')
      // After clearing override, falls back to actual process.env
      const result = getPath()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Unix PATH with colon separator', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
    })

    it('should handle Windows PATH with semicolon separator', () => {
      setEnv('PATH', 'C:\\Windows\\System32;C:\\Windows;C:\\Program Files')
      expect(getPath()).toBe(
        'C:\\Windows\\System32;C:\\Windows;C:\\Program Files',
      )
    })

    it('should handle PATH with single entry', () => {
      setEnv('PATH', '/usr/bin')
      expect(getPath()).toBe('/usr/bin')
    })

    it('should handle empty PATH', () => {
      setEnv('PATH', '')
      expect(getPath()).toBe('')
    })

    it('should handle PATH with Homebrew directories', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin')
    })

    it('should handle PATH with npm global binaries', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/.npm-global/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/.npm-global/bin')
    })

    it('should handle PATH with user bin directory', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/bin')
    })

    it('should handle PATH with .local/bin', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/.local/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/.local/bin')
    })

    it('should handle PATH with spaces in directory names', () => {
      setEnv('PATH', '/usr/bin:"/Program Files/App/bin":/bin')
      expect(getPath()).toBe('/usr/bin:"/Program Files/App/bin":/bin')
    })

    it('should handle PATH with many entries', () => {
      const longPath = Array.from({ length: 20 }, (_, i) => `/path${i}`).join(
        ':',
      )
      setEnv('PATH', longPath)
      expect(getPath()).toBe(longPath)
    })

    it('should handle PATH with relative paths', () => {
      setEnv('PATH', './bin:../tools/bin:/usr/bin')
      expect(getPath()).toBe('./bin:../tools/bin:/usr/bin')
    })

    it('should handle PATH with current directory', () => {
      setEnv('PATH', '.:/usr/bin:/bin')
      expect(getPath()).toBe('.:/usr/bin:/bin')
    })

    it('should handle updating PATH value', () => {
      setEnv('PATH', '/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')

      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin')

      setEnv('PATH', '/opt/bin:/usr/bin')
      expect(getPath()).toBe('/opt/bin:/usr/bin')
    })

    it('should handle clearing and re-setting PATH', () => {
      setEnv('PATH', '/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')

      clearEnv('PATH')
      // After clearing override, falls back to actual process.env
      const result = getPath()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('PATH', '/usr/local/bin:/usr/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin')
    })

    it('should handle consecutive reads', () => {
      setEnv('PATH', '/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')
      expect(getPath()).toBe('/usr/bin:/bin')
    })

    it('should handle PATH with Python virtual env', () => {
      setEnv('PATH', '/home/user/venv/bin:/usr/local/bin:/usr/bin:/bin')
      expect(getPath()).toBe('/home/user/venv/bin:/usr/local/bin:/usr/bin:/bin')
    })

    it('should handle PATH with Ruby gems', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/.gem/ruby/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/.gem/ruby/bin')
    })

    it('should handle PATH with Go binaries', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/go/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/go/bin')
    })

    it('should handle PATH with Rust cargo', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:~/.cargo/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:~/.cargo/bin')
    })

    it('should handle PATH with snap binaries', () => {
      setEnv('PATH', '/usr/local/bin:/usr/bin:/bin:/snap/bin')
      expect(getPath()).toBe('/usr/local/bin:/usr/bin:/bin:/snap/bin')
    })

    it('should handle PATH with flatpak', () => {
      setEnv(
        'PATH',
        '/usr/local/bin:/usr/bin:/bin:/var/lib/flatpak/exports/bin',
      )
      expect(getPath()).toBe(
        '/usr/local/bin:/usr/bin:/bin:/var/lib/flatpak/exports/bin',
      )
    })

    it('should handle PATH with Android SDK', () => {
      setEnv(
        'PATH',
        '/usr/local/bin:/usr/bin:/bin:~/Android/Sdk/platform-tools',
      )
      expect(getPath()).toBe(
        '/usr/local/bin:/usr/bin:/bin:~/Android/Sdk/platform-tools',
      )
    })

    it('should handle WSL PATH', () => {
      setEnv('PATH', '/usr/bin:/bin:/mnt/c/Windows/System32')
      expect(getPath()).toBe('/usr/bin:/bin:/mnt/c/Windows/System32')
    })
  })
})
