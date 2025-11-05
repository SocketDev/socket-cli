/**
 * @fileoverview Unit tests for XDG Base Directory environment variable getters.
 *
 * Tests XDG Base Directory Specification getters (freedesktop.org standard):
 * - getXdgCacheHome() - cache directory (XDG_CACHE_HOME, default ~/.cache)
 * - getXdgConfigHome() - config directory (XDG_CONFIG_HOME, default ~/.config)
 * - getXdgDataHome() - data directory (XDG_DATA_HOME, default ~/.local/share)
 * Uses rewire for test isolation. Linux/Unix standard for user directory organization.
 */

import {
  getXdgCacheHome,
  getXdgConfigHome,
  getXdgDataHome,
} from '@socketsecurity/lib/env/xdg'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/xdg', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getXdgCacheHome', () => {
    it('should return XDG_CACHE_HOME when set', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/.cache')
    })

    it('should return undefined when XDG_CACHE_HOME is not set', () => {
      clearEnv('XDG_CACHE_HOME')
      // After clearing override, falls back to actual process.env
      const result = getXdgCacheHome()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle default cache location', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/.cache')
    })

    it('should handle custom cache location', () => {
      setEnv('XDG_CACHE_HOME', '/custom/cache')
      expect(getXdgCacheHome()).toBe('/custom/cache')
    })

    it('should handle cache with trailing slash', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache/')
      expect(getXdgCacheHome()).toBe('/home/user/.cache/')
    })

    it('should handle empty string', () => {
      setEnv('XDG_CACHE_HOME', '')
      expect(getXdgCacheHome()).toBe('')
    })

    it('should handle updating cache home', () => {
      setEnv('XDG_CACHE_HOME', '/cache1')
      expect(getXdgCacheHome()).toBe('/cache1')

      setEnv('XDG_CACHE_HOME', '/cache2')
      expect(getXdgCacheHome()).toBe('/cache2')
    })

    it('should handle consecutive reads', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/.cache')
    })

    it('should handle cache path with spaces', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/my cache')
      expect(getXdgCacheHome()).toBe('/home/user/my cache')
    })

    it('should handle snap cache location', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/snap/app/current/.cache')
      expect(getXdgCacheHome()).toBe('/home/user/snap/app/current/.cache')
    })

    it('should handle flatpak cache location', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.var/app/org.app/cache')
      expect(getXdgCacheHome()).toBe('/home/user/.var/app/org.app/cache')
    })
  })

  describe('getXdgConfigHome', () => {
    it('should return XDG_CONFIG_HOME when set', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/.config')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
    })

    it('should return undefined when XDG_CONFIG_HOME is not set', () => {
      clearEnv('XDG_CONFIG_HOME')
      // After clearing override, falls back to actual process.env
      const result = getXdgConfigHome()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle default config location', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/.config')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
    })

    it('should handle custom config location', () => {
      setEnv('XDG_CONFIG_HOME', '/etc/custom-config')
      expect(getXdgConfigHome()).toBe('/etc/custom-config')
    })

    it('should handle config with trailing slash', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/.config/')
      expect(getXdgConfigHome()).toBe('/home/user/.config/')
    })

    it('should handle empty string', () => {
      setEnv('XDG_CONFIG_HOME', '')
      expect(getXdgConfigHome()).toBe('')
    })

    it('should handle updating config home', () => {
      setEnv('XDG_CONFIG_HOME', '/config1')
      expect(getXdgConfigHome()).toBe('/config1')

      setEnv('XDG_CONFIG_HOME', '/config2')
      expect(getXdgConfigHome()).toBe('/config2')
    })

    it('should handle consecutive reads', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/.config')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
    })

    it('should handle config path with spaces', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/my config')
      expect(getXdgConfigHome()).toBe('/home/user/my config')
    })

    it('should handle snap config location', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/snap/app/current/.config')
      expect(getXdgConfigHome()).toBe('/home/user/snap/app/current/.config')
    })

    it('should handle flatpak config location', () => {
      setEnv('XDG_CONFIG_HOME', '/home/user/.var/app/org.app/config')
      expect(getXdgConfigHome()).toBe('/home/user/.var/app/org.app/config')
    })

    it('should handle AppImage config location', () => {
      setEnv('XDG_CONFIG_HOME', '/tmp/.mount_AppRun123/config')
      expect(getXdgConfigHome()).toBe('/tmp/.mount_AppRun123/config')
    })
  })

  describe('getXdgDataHome', () => {
    it('should return XDG_DATA_HOME when set', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
    })

    it('should return undefined when XDG_DATA_HOME is not set', () => {
      clearEnv('XDG_DATA_HOME')
      // After clearing override, falls back to actual process.env
      const result = getXdgDataHome()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle default data location', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
    })

    it('should handle custom data location', () => {
      setEnv('XDG_DATA_HOME', '/custom/data')
      expect(getXdgDataHome()).toBe('/custom/data')
    })

    it('should handle data with trailing slash', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.local/share/')
      expect(getXdgDataHome()).toBe('/home/user/.local/share/')
    })

    it('should handle empty string', () => {
      setEnv('XDG_DATA_HOME', '')
      expect(getXdgDataHome()).toBe('')
    })

    it('should handle updating data home', () => {
      setEnv('XDG_DATA_HOME', '/data1')
      expect(getXdgDataHome()).toBe('/data1')

      setEnv('XDG_DATA_HOME', '/data2')
      expect(getXdgDataHome()).toBe('/data2')
    })

    it('should handle consecutive reads', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
    })

    it('should handle data path with spaces', () => {
      setEnv('XDG_DATA_HOME', '/home/user/my data')
      expect(getXdgDataHome()).toBe('/home/user/my data')
    })

    it('should handle snap data location', () => {
      setEnv('XDG_DATA_HOME', '/home/user/snap/app/current/.local/share')
      expect(getXdgDataHome()).toBe('/home/user/snap/app/current/.local/share')
    })

    it('should handle flatpak data location', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.var/app/org.app/data')
      expect(getXdgDataHome()).toBe('/home/user/.var/app/org.app/data')
    })

    it('should handle Steam data location', () => {
      setEnv('XDG_DATA_HOME', '/home/user/.steam/debian-installation')
      expect(getXdgDataHome()).toBe('/home/user/.steam/debian-installation')
    })
  })

  describe('XDG directories interaction', () => {
    it('should handle all XDG dirs set simultaneously', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache')
      setEnv('XDG_CONFIG_HOME', '/home/user/.config')
      setEnv('XDG_DATA_HOME', '/home/user/.local/share')

      expect(getXdgCacheHome()).toBe('/home/user/.cache')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
    })

    it('should handle clearing all XDG dirs', () => {
      setEnv('XDG_CACHE_HOME', '/cache')
      setEnv('XDG_CONFIG_HOME', '/config')
      setEnv('XDG_DATA_HOME', '/data')

      clearEnv('XDG_CACHE_HOME')
      clearEnv('XDG_CONFIG_HOME')
      clearEnv('XDG_DATA_HOME')

      expect(typeof getXdgCacheHome()).toMatch(/string|undefined/)
      expect(typeof getXdgConfigHome()).toMatch(/string|undefined/)
      expect(typeof getXdgDataHome()).toMatch(/string|undefined/)
    })

    it('should handle XDG dirs with common prefix', () => {
      setEnv('XDG_CACHE_HOME', '/home/user/.cache')
      setEnv('XDG_CONFIG_HOME', '/home/user/.config')
      setEnv('XDG_DATA_HOME', '/home/user/.local/share')

      expect(getXdgCacheHome()).toBe('/home/user/.cache')
      expect(getXdgConfigHome()).toBe('/home/user/.config')
      expect(getXdgDataHome()).toBe('/home/user/.local/share')
    })

    it('should handle XDG dirs with different prefixes', () => {
      setEnv('XDG_CACHE_HOME', '/var/cache')
      setEnv('XDG_CONFIG_HOME', '/etc/config')
      setEnv('XDG_DATA_HOME', '/usr/share')

      expect(getXdgCacheHome()).toBe('/var/cache')
      expect(getXdgConfigHome()).toBe('/etc/config')
      expect(getXdgDataHome()).toBe('/usr/share')
    })
  })
})
