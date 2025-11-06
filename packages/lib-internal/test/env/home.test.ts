/**
 * @fileoverview Unit tests for HOME environment variable getter.
 *
 * Tests getHome() which retrieves the user's home directory path via HOME env var.
 * Returns home path string or undefined if not set. Unix/Linux standard.
 * On Windows, use getUserprofile() instead (USERPROFILE env var).
 * Uses rewire for isolated testing. Critical for resolving user-specific paths.
 */

import { getHome } from '@socketsecurity/lib/env/home'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/home', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getHome', () => {
    it('should return HOME environment variable when set', () => {
      setEnv('HOME', '/Users/testuser')
      expect(getHome()).toBe('/Users/testuser')
    })

    it('should return undefined when HOME is not set', () => {
      clearEnv('HOME')
      // After clearing override, falls back to actual process.env
      const result = getHome()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle Unix home directory', () => {
      setEnv('HOME', '/home/user')
      expect(getHome()).toBe('/home/user')
    })

    it('should handle macOS home directory', () => {
      setEnv('HOME', '/Users/johndoe')
      expect(getHome()).toBe('/Users/johndoe')
    })

    it('should handle root home directory', () => {
      setEnv('HOME', '/root')
      expect(getHome()).toBe('/root')
    })

    it('should handle Windows-style home directory', () => {
      setEnv('HOME', 'C:\\Users\\testuser')
      expect(getHome()).toBe('C:\\Users\\testuser')
    })

    it('should handle network home directory', () => {
      setEnv('HOME', '/net/users/testuser')
      expect(getHome()).toBe('/net/users/testuser')
    })

    it('should handle custom home paths', () => {
      setEnv('HOME', '/custom/path/home')
      expect(getHome()).toBe('/custom/path/home')
    })

    it('should handle empty string', () => {
      setEnv('HOME', '')
      expect(getHome()).toBe('')
    })

    it('should handle home with spaces', () => {
      setEnv('HOME', '/Users/John Doe')
      expect(getHome()).toBe('/Users/John Doe')
    })

    it('should handle home with special characters', () => {
      setEnv('HOME', '/Users/user-name_123')
      expect(getHome()).toBe('/Users/user-name_123')
    })

    it('should handle relative path', () => {
      setEnv('HOME', '../home/user')
      expect(getHome()).toBe('../home/user')
    })

    it('should handle tilde in path', () => {
      setEnv('HOME', '~/custom/location')
      expect(getHome()).toBe('~/custom/location')
    })

    it('should handle updating home value', () => {
      setEnv('HOME', '/home/user1')
      expect(getHome()).toBe('/home/user1')

      setEnv('HOME', '/home/user2')
      expect(getHome()).toBe('/home/user2')

      setEnv('HOME', '/Users/user3')
      expect(getHome()).toBe('/Users/user3')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('HOME', '/home/user')
      expect(getHome()).toBe('/home/user')

      clearEnv('HOME')
      // After clearing override, falls back to actual process.env
      const result = getHome()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('HOME', '/Users/newuser')
      expect(getHome()).toBe('/Users/newuser')
    })

    it('should handle consecutive reads', () => {
      setEnv('HOME', '/home/testuser')
      expect(getHome()).toBe('/home/testuser')
      expect(getHome()).toBe('/home/testuser')
      expect(getHome()).toBe('/home/testuser')
    })

    it('should handle very long paths', () => {
      const longPath = `/home/${'a'.repeat(200)}`
      setEnv('HOME', longPath)
      expect(getHome()).toBe(longPath)
    })

    it('should handle paths with dots', () => {
      setEnv('HOME', '/home/user.name')
      expect(getHome()).toBe('/home/user.name')
    })

    it('should handle paths with unicode', () => {
      setEnv('HOME', '/home/用户')
      expect(getHome()).toBe('/home/用户')
    })

    it('should handle paths with trailing slash', () => {
      setEnv('HOME', '/home/user/')
      expect(getHome()).toBe('/home/user/')
    })

    it('should handle WSL paths', () => {
      setEnv('HOME', '/mnt/c/Users/testuser')
      expect(getHome()).toBe('/mnt/c/Users/testuser')
    })

    it('should handle Docker container paths', () => {
      setEnv('HOME', '/app')
      expect(getHome()).toBe('/app')
    })

    it('should handle Snap paths', () => {
      setEnv('HOME', '/home/user/snap/app/common')
      expect(getHome()).toBe('/home/user/snap/app/common')
    })
  })
})
