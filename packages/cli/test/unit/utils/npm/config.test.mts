import { beforeEach, describe, expect, it, vi } from 'vitest'

// Create mock instance that will be returned by constructor.
const mockNpmConfigInstance = {
  load: vi.fn().mockResolvedValue(undefined),
  flat: {
    registry: 'https://registry.npmjs.org/',
    cache: '/home/user/.npm',
    prefix: '/usr/local',
  },
}

// Mock @npmcli/config with a proper constructor class.
// Using function syntax to make it a proper constructor.
vi.mock('@npmcli/config', () => ({
  default: vi.fn(function MockNpmConfig() {
    return mockNpmConfigInstance
  }),
}))

import { getNpmConfig } from '../../../../../src/utils/npm/config.mts'

import NpmConfig from '@npmcli/config'

// Mock @npmcli/config/lib/definitions.
vi.mock('@npmcli/config/lib/definitions', () => ({
  definitions: {},
  flatten: vi.fn(),
  shorthands: {},
}))

// Mock npm-paths.
vi.mock('./paths.mts', () => ({
  getNpmDirPath: vi.fn(() => '/usr/local/lib/node_modules/npm'),
}))

const MockNpmConfig = vi.mocked(NpmConfig)

describe('npm-config utilities', () => {
  beforeEach(() => {
    // Clear mock calls.
    MockNpmConfig.mockClear()
    vi.mocked(mockNpmConfigInstance.load).mockClear()
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
      // Use MockNpmConfig directly

      await getNpmConfig({ cwd: '/custom/path' })

      expect(MockNpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/custom/path',
        }),
      )
    })

    it('uses custom env option', async () => {
      // Use MockNpmConfig directly
      const customEnv = { NODE_ENV: 'test', FOO: 'bar' }

      await getNpmConfig({ env: customEnv })

      expect(MockNpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          env: customEnv,
        }),
      )
    })

    it('uses custom npmPath option', async () => {
      // Use MockNpmConfig directly

      await getNpmConfig({ npmPath: '/custom/npm/path' })

      expect(MockNpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          npmPath: '/custom/npm/path',
        }),
      )
    })

    it('uses custom platform option', async () => {
      // Use MockNpmConfig directly

      await getNpmConfig({ platform: 'win32' })

      expect(MockNpmConfig).toHaveBeenCalledWith(
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
      // Use MockNpmConfig directly

      await getNpmConfig({ execPath: '/usr/bin/node' })

      expect(MockNpmConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          execPath: '/usr/bin/node',
        }),
      )
    })

    it('calls config.load()', async () => {
      await getNpmConfig()

      expect(mockNpmConfigInstance.load).toHaveBeenCalled()
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
