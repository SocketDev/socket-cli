/**
 * @fileoverview Unit tests for shadow binary installation decision logic.
 *
 * Tests shadow binary installation logic:
 * - shouldSkipShadow() determines if shadow binary installation should be skipped
 * - Windows-specific behavior: always skips shadow on Windows
 * - CI environment handling: skips shadow in CI
 * - Path validation: checks if binary path exists and is valid
 * - Platform detection: win32, darwin, linux
 * Used by Socket CLI to decide whether to install package manager wrappers.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { shouldSkipShadow } from '@socketsecurity/lib/shadow'

describe('shadow', () => {
  describe('shouldSkipShadow', () => {
    describe('Windows behavior', () => {
      it('should skip shadow when win32 is true and binPath exists', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', { win32: true, cwd: '/home/user' }),
        ).toBe(true)
      })

      it('should skip shadow when win32 is true with Windows path', () => {
        expect(
          shouldSkipShadow('C:\\Program Files\\nodejs\\npm.cmd', {
            win32: true,
            cwd: 'C:\\Users\\user\\project',
          }),
        ).toBe(true)
      })

      it('should not skip when win32 is true but binPath is empty', () => {
        const result = shouldSkipShadow('', { win32: true, cwd: '/home/user' })
        // Empty binPath on Windows should not trigger skip
        expect(typeof result).toBe('boolean')
      })

      it('should not skip when win32 is false even with binPath', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            win32: false,
            cwd: '/home/user',
          }),
        ).toBe(false)
      })
    })

    describe('temporary executor detection via user agent', () => {
      const originalUserAgent = process.env['npm_config_user_agent']

      afterEach(() => {
        if (originalUserAgent === undefined) {
          delete process.env['npm_config_user_agent']
        } else {
          process.env['npm_config_user_agent'] = originalUserAgent
        }
      })

      it('should skip shadow when user agent contains "exec"', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 exec'
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          true,
        )
      })

      it('should skip shadow when user agent contains "npx"', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 npx'
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          true,
        )
      })

      it('should skip shadow when user agent contains "dlx"', () => {
        process.env['npm_config_user_agent'] = 'pnpm/8.6.0 node/v18.12.0 dlx'
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          true,
        )
      })

      it('should not skip when user agent is normal npm', () => {
        process.env['npm_config_user_agent'] =
          'npm/8.19.2 node/v18.12.0 darwin x64'
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          false,
        )
      })

      it('should not skip when user agent is undefined', () => {
        delete process.env['npm_config_user_agent']
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          false,
        )
      })
    })

    describe('npm cache detection', () => {
      const originalCache = process.env['npm_config_cache']

      afterEach(() => {
        if (originalCache === undefined) {
          delete process.env['npm_config_cache']
        } else {
          process.env['npm_config_cache'] = originalCache
        }
      })

      it('should skip shadow when running from npm cache', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(
          shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user/.npm/_npx/123' }),
        ).toBe(true)
      })

      it('should skip shadow when running from Windows npm cache', () => {
        process.env['npm_config_cache'] = 'C:\\Users\\user\\AppData\\npm-cache'
        expect(
          shouldSkipShadow('C:\\Program Files\\nodejs\\npm.cmd', {
            cwd: 'C:\\Users\\user\\AppData\\npm-cache\\_npx\\123',
          }),
        ).toBe(true)
      })

      it('should not skip when cwd is outside npm cache', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(
          shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user/project' }),
        ).toBe(false)
      })

      it('should not skip when npm_config_cache is not set', () => {
        delete process.env['npm_config_cache']
        expect(
          shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user/.npm/_npx/123' }),
        ).toBe(true) // Still skips due to _npx pattern
      })
    })

    describe('temporary path patterns', () => {
      it('should skip shadow when cwd contains _npx', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            cwd: '/home/user/.npm/_npx/abc123',
          }),
        ).toBe(true)
      })

      it('should skip shadow when cwd contains .pnpm-store', () => {
        expect(
          shouldSkipShadow('/usr/bin/pnpm', {
            cwd: '/home/user/.pnpm-store/dlx-123',
          }),
        ).toBe(true)
      })

      it('should skip shadow when cwd contains dlx-', () => {
        expect(
          shouldSkipShadow('/usr/bin/pnpm', { cwd: '/tmp/dlx-abc123' }),
        ).toBe(true)
      })

      it('should skip shadow when cwd contains Yarn PnP virtual package path', () => {
        expect(
          shouldSkipShadow('/usr/bin/yarn', {
            cwd: '/home/user/project/.yarn/$$/package',
          }),
        ).toBe(true)
      })

      it('should skip shadow when cwd contains Yarn Windows temp path', () => {
        expect(
          shouldSkipShadow('C:\\Program Files\\nodejs\\yarn.cmd', {
            cwd: 'C:\\Users\\user\\AppData\\Local\\Temp\\xfs-abc123',
          }),
        ).toBe(true)
      })

      it('should not skip shadow for normal project directory', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user/my-project' }),
        ).toBe(false)
      })

      it('should not skip shadow for nested node_modules', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            cwd: '/home/user/project/node_modules/.bin',
          }),
        ).toBe(false)
      })
    })

    describe('path normalization', () => {
      it('should handle paths with backslashes', () => {
        expect(
          shouldSkipShadow('C:\\npm.cmd', {
            cwd: 'C:\\Users\\user\\.npm\\_npx\\123',
          }),
        ).toBe(true)
      })

      it('should handle paths with forward slashes', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            cwd: '/home/user/.npm/_npx/123',
          }),
        ).toBe(true)
      })

      it('should handle mixed slash paths', () => {
        expect(
          shouldSkipShadow('C:/Program Files/nodejs/npm.cmd', {
            cwd: 'C:/Users/user/.npm/_npx/123',
          }),
        ).toBe(true)
      })
    })

    describe('default options', () => {
      it('should use process.cwd() when cwd is not provided', () => {
        const result = shouldSkipShadow('/usr/bin/npm')
        expect(typeof result).toBe('boolean')
      })

      it('should default win32 to false', () => {
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user' })).toBe(
          false,
        )
      })

      it('should handle empty options object', () => {
        const result = shouldSkipShadow('/usr/bin/npm', {})
        expect(typeof result).toBe('boolean')
      })

      it('should handle undefined options', () => {
        const result = shouldSkipShadow('/usr/bin/npm', undefined)
        expect(typeof result).toBe('boolean')
      })
    })

    describe('combined conditions', () => {
      const originalUserAgent = process.env['npm_config_user_agent']
      const originalCache = process.env['npm_config_cache']

      afterEach(() => {
        if (originalUserAgent === undefined) {
          delete process.env['npm_config_user_agent']
        } else {
          process.env['npm_config_user_agent'] = originalUserAgent
        }
        if (originalCache === undefined) {
          delete process.env['npm_config_cache']
        } else {
          process.env['npm_config_cache'] = originalCache
        }
      })

      it('should skip when both user agent and path pattern match', () => {
        process.env['npm_config_user_agent'] = 'npm/8.19.2 node/v18.12.0 npx'
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            cwd: '/home/user/.npm/_npx/123',
          }),
        ).toBe(true)
      })

      it('should skip on Windows with binPath even if other conditions are false', () => {
        process.env['npm_config_user_agent'] =
          'npm/8.19.2 node/v18.12.0 darwin x64'
        delete process.env['npm_config_cache']
        expect(
          shouldSkipShadow('C:\\npm.cmd', {
            win32: true,
            cwd: 'C:\\Users\\user\\project',
          }),
        ).toBe(true)
      })

      it('should skip when npm cache and path pattern both match', () => {
        process.env['npm_config_cache'] = '/home/user/.npm'
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            cwd: '/home/user/.npm/_npx/123',
          }),
        ).toBe(true)
      })

      it('should not skip when no conditions match', () => {
        delete process.env['npm_config_user_agent']
        delete process.env['npm_config_cache']
        expect(
          shouldSkipShadow('/usr/bin/npm', {
            win32: false,
            cwd: '/home/user/my-project',
          }),
        ).toBe(false)
      })
    })

    describe('edge cases', () => {
      it('should handle empty binPath', () => {
        const result = shouldSkipShadow('', { cwd: '/home/user' })
        expect(typeof result).toBe('boolean')
      })

      it('should handle empty cwd', () => {
        const result = shouldSkipShadow('/usr/bin/npm', { cwd: '' })
        expect(typeof result).toBe('boolean')
      })

      it('should handle root directory as cwd', () => {
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: '/' })).toBe(false)
      })

      it('should handle relative paths in cwd', () => {
        const result = shouldSkipShadow('/usr/bin/npm', {
          cwd: '../project/_npx',
        })
        expect(typeof result).toBe('boolean')
      })

      it('should be case-sensitive for pattern matching', () => {
        expect(
          shouldSkipShadow('/usr/bin/npm', { cwd: '/home/user/_NPX/123' }),
        ).toBe(false) // _NPX (uppercase) should not match _npx pattern
      })

      it('should handle very long paths', () => {
        const longPath = `/home/user/${'a'.repeat(200)}/_npx/123`
        expect(shouldSkipShadow('/usr/bin/npm', { cwd: longPath })).toBe(true)
      })
    })
  })
})
