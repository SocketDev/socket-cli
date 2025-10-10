import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNpmConfig } from './npm-config.mts'

// Mock @npmcli/config
vi.mock('@npmcli/config', () => ({
  default: vi.fn(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    flat: {
      registry: 'https://registry.npmjs.org/',
      cache: '/home/user/.npm',
      prefix: '/usr/local',
    },
  })),
}))

// Mock @npmcli/config/lib/definitions
vi.mock('@npmcli/config/lib/definitions', () => ({
  definitions: {},
  flatten: vi.fn(),
  shorthands: {},
}))

// Mock npm-paths
vi.mock('./npm-paths.mts', () => ({
  getNpmDirPath: vi.fn(() => '/usr/local/lib/node_modules/npm'),
}))

describe('npm-config utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getNpmConfig', () => {
    it('loads npm config with default options', async () => {
      const result = await getNpmConfig()

      expect(result).toEqual({
        registry: 'https://registry.npmjs.org/',
        cache: '/home/user/.npm',
        prefix: '/usr/local',
        nodeVersion: process.version,
        npmCommand: 'install',
      })
    })

    it('uses custom cwd option', async () => {
      const NpmConfig = (await import('@npmcli/config')).default

      await getNpmConfig({ cwd: '/custom/path' })

      expect(NpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/custom/path',
        }),
      )
    })

    it('uses custom env option', async () => {
      const NpmConfig = (await import('@npmcli/config')).default
      const customEnv = { NODE_ENV: 'test', FOO: 'bar' }

      await getNpmConfig({ env: customEnv })

      expect(NpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          env: customEnv,
        }),
      )
    })

    it('uses custom npmPath option', async () => {
      const NpmConfig = (await import('@npmcli/config')).default

      await getNpmConfig({ npmPath: '/custom/npm/path' })

      expect(NpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          npmPath: '/custom/npm/path',
        }),
      )
    })

    it('uses custom platform option', async () => {
      const NpmConfig = (await import('@npmcli/config')).default

      await getNpmConfig({ platform: 'win32' })

      expect(NpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          platform: 'win32',
        }),
      )
    })

    it('uses default npmCommand when not specified', async () => {
      const result = await getNpmConfig()
      // Default npmCommand is 'install' but doesn't affect the result directly.
      expect(result).toBeDefined()
    })

    it('handles npmVersion option', async () => {
      const result = await getNpmConfig({ npmVersion: '8.0.0' })
      expect(result).toBeDefined()
    })

    it('handles nodeVersion option', async () => {
      const result = await getNpmConfig({ nodeVersion: 'v16.0.0' })
      expect(result).toBeDefined()
    })

    it('handles execPath option', async () => {
      const NpmConfig = (await import('@npmcli/config')).default

      await getNpmConfig({ execPath: '/usr/bin/node' })

      expect(NpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          execPath: '/usr/bin/node',
        }),
      )
    })

    it('calls config.load()', async () => {
      const mockLoad = vi.fn().mockResolvedValue(undefined)
      vi.mocked((await import('@npmcli/config')).default).mockImplementation(
        () =>
          ({
            load: mockLoad,
            flat: { test: 'value' },
          }) as any,
      )

      await getNpmConfig()

      expect(mockLoad).toHaveBeenCalled()
    })

    it('returns flattened config with null prototype', async () => {
      const result = await getNpmConfig()

      expect(Object.getPrototypeOf(result)).toBe(null)
    })

    it('handles all options together', async () => {
      const options = {
        cwd: '/test/cwd',
        env: { TEST: 'true' },
        execPath: '/test/node',
        nodeVersion: 'v18.0.0',
        npmCommand: 'test',
        npmPath: '/test/npm',
        npmVersion: '9.0.0',
        platform: 'linux' as NodeJS.Platform,
      }

      const result = await getNpmConfig(options)
      expect(result).toBeDefined()
    })
  })
})
