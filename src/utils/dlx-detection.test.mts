import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

import {
  isRunningInTemporaryExecutor,
  shouldSkipShadow,
} from './dlx-detection.mts'

// Mock the dependencies.
vi.mock('@socketsecurity/registry/lib/path', () => ({
  normalizePath: vi.fn((p: string) => p.replace(/\\/g, '/')),
}))

vi.mock('../constants.mts', () => ({
  default: {
    ENV: {
      npm_config_user_agent: undefined,
      npm_config_cache: undefined,
    },
  },
}))

describe('dlx-detection', () => {
  let originalEnv: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const constants = (await import('../constants.mts')).default
    originalEnv = { ...constants.ENV }
  })

  afterEach(async () => {
    const constants = (await import('../constants.mts')).default
    constants.ENV = originalEnv
  })

  describe('isRunningInTemporaryExecutor', () => {
    it('returns false when not in temporary executor', async () => {
      const result = isRunningInTemporaryExecutor()
      expect(result).toBe(false)
    })

    it('detects npm exec in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'npm/8.0.0 node/v16.0.0 darwin exec'

      const result = isRunningInTemporaryExecutor()
      expect(result).toBe(true)
    })

    it('detects npx in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'npm/8.0.0 node/v16.0.0 darwin npx'

      const result = isRunningInTemporaryExecutor()
      expect(result).toBe(true)
    })

    it('detects pnpm dlx in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'pnpm/7.0.0 node/v16.0.0 darwin dlx'

      const result = isRunningInTemporaryExecutor()
      expect(result).toBe(true)
    })

    // Note: Tests that depend on __dirname cannot be easily tested without complex mocking.
    // The function uses __dirname which is a module-level global.
    // We test the path pattern logic through shouldSkipShadow which accepts a cwd parameter.

    it('returns false for non-temporary executor environments', () => {
      const result = isRunningInTemporaryExecutor()
      // Default environment should not be detected as temporary.
      expect(result).toBe(false)
    })
  })

  describe('shouldSkipShadow', () => {
    it('skips on Windows when binary path exists', () => {
      const result = shouldSkipShadow('C:\\npm\\npm.cmd', { win32: true })
      expect(result).toBe(true)
    })

    it('does not skip on Windows when no binary path', () => {
      const result = shouldSkipShadow('', { win32: true })
      expect(result).toBe(false)
    })

    it('does not skip on Unix even with binary path', () => {
      const result = shouldSkipShadow('/usr/local/bin/npm', { win32: false })
      expect(result).toBe(false)
    })

    it('skips when npm exec in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'npm/8.0.0 node/v16.0.0 darwin exec'

      const result = shouldSkipShadow('/usr/local/bin/npm', {})
      expect(result).toBe(true)
    })

    it('skips when npx in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'npm/8.0.0 node/v16.0.0 darwin npx'

      const result = shouldSkipShadow('/usr/local/bin/npm', {})
      expect(result).toBe(true)
    })

    it('skips when dlx in user agent', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_user_agent = 'pnpm/7.0.0 node/v16.0.0 darwin dlx'

      const result = shouldSkipShadow('/usr/local/bin/pnpm', {})
      expect(result).toBe(true)
    })

    it('skips when cwd is in npm cache', async () => {
      const constants = (await import('../constants.mts')).default
      constants.ENV.npm_config_cache = '/Users/test/.npm'

      const result = shouldSkipShadow('/usr/local/bin/npm', {
        cwd: '/Users/test/.npm/_npx/12345/node_modules/.bin',
      })
      expect(result).toBe(true)
    })

    it('skips when cwd contains _npx', () => {
      const result = shouldSkipShadow('/usr/local/bin/npm', {
        cwd: '/var/folders/abc/_npx/12345/node_modules/.bin',
      })
      expect(result).toBe(true)
    })

    it('skips when cwd contains .pnpm-store', () => {
      const result = shouldSkipShadow('/usr/local/bin/pnpm', {
        cwd: '/home/user/.pnpm-store/v3/tmp/dlx-12345',
      })
      expect(result).toBe(true)
    })

    it('skips when cwd contains dlx- prefix', () => {
      const result = shouldSkipShadow('/usr/local/bin/pnpm', {
        cwd: '/tmp/dlx-socket-cli-12345/node_modules/.bin',
      })
      expect(result).toBe(true)
    })

    it('skips when cwd contains Yarn virtual packages', () => {
      const result = shouldSkipShadow('/usr/local/bin/yarn', {
        cwd: '/project/.yarn/$$virtual/package-name',
      })
      expect(result).toBe(true)
    })

    it('skips when cwd contains Yarn Windows temp', () => {
      // Test both Unix and Windows style paths.
      const resultUnixStyle = shouldSkipShadow('/usr/local/bin/yarn', {
        cwd: 'C:/Users/test/AppData/Local/Temp/xfs-12345',
      })
      expect(resultUnixStyle).toBe(true)

      // Windows style path.
      const resultWinStyle = shouldSkipShadow('/usr/local/bin/yarn', {
        cwd: 'C:\\Users\\test\\AppData\\Local\\Temp\\xfs-12345',
      })
      expect(resultWinStyle).toBe(true)
    })

    it('does not skip for regular project paths', () => {
      const result = shouldSkipShadow('/usr/local/bin/npm', {
        cwd: '/home/user/projects/my-app/node_modules/.bin',
      })
      expect(result).toBe(false)
    })

    it('uses process.cwd() when cwd not provided', () => {
      vi.spyOn(process, 'cwd').mockReturnValue('/home/user/projects/my-app')
      const result = shouldSkipShadow('/usr/local/bin/npm', {})
      expect(result).toBe(false)
    })

    it('uses default win32 value when not provided', () => {
      const result = shouldSkipShadow('/usr/local/bin/npm', {
        cwd: '/home/user/projects',
      })
      expect(result).toBe(false)
    })

    it('handles undefined options gracefully', () => {
      vi.spyOn(process, 'cwd').mockReturnValue('/home/user/projects')
      const result = shouldSkipShadow('/usr/local/bin/npm', undefined as any)
      expect(result).toBe(false)
    })
  })
})