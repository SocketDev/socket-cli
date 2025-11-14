import { createRequire } from 'node:module'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import constants from '../constants.mts'
import { spawnDlx } from './dlx.mts'

import type { DlxPackageSpec } from './dlx.mts'

const require = createRequire(import.meta.url)

describe('utils/dlx', () => {
  describe('spawnDlx', () => {
    let mockShadowPnpmBin: ReturnType<typeof vi.fn>
    let mockShadowNpxBin: ReturnType<typeof vi.fn>
    let mockShadowYarnBin: ReturnType<typeof vi.fn>

    beforeEach(() => {
      // Create mock functions that return a promise with spawnPromise.
      const createMockBin = () =>
        vi.fn().mockResolvedValue({
          spawnPromise: Promise.resolve({ stdout: '', stderr: '' }),
        })

      mockShadowPnpmBin = createMockBin()
      mockShadowNpxBin = createMockBin()
      mockShadowYarnBin = createMockBin()

      // Mock the require calls for shadow binaries.
      vi.spyOn(require, 'resolve').mockImplementation((id: string) => {
        if (id === constants.shadowPnpmBinPath) {
          return id
        }
        if (id === constants.shadowNpxBinPath) {
          return id
        }
        if (id === constants.shadowYarnBinPath) {
          return id
        }
        throw new Error(`Unexpected require: ${id}`)
      })

      // @ts-ignore
      require.cache[constants.shadowPnpmBinPath] = {
        exports: mockShadowPnpmBin,
      }
      // @ts-ignore
      require.cache[constants.shadowNpxBinPath] = { exports: mockShadowNpxBin }
      // @ts-ignore
      require.cache[constants.shadowYarnBinPath] = {
        exports: mockShadowYarnBin,
      }
    })

    afterEach(() => {
      vi.restoreAllMocks()
      // Clean up require cache.
      // @ts-ignore
      delete require.cache[constants.shadowPnpmBinPath]
      // @ts-ignore
      delete require.cache[constants.shadowNpxBinPath]
      // @ts-ignore
      delete require.cache[constants.shadowYarnBinPath]
    })

    it('should place --silent before dlx for pnpm', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '~1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], {
        agent: 'pnpm',
        silent: true,
      })

      expect(mockShadowPnpmBin).toHaveBeenCalledTimes(1)
      const [spawnArgs] = mockShadowPnpmBin.mock.calls[0]

      // Verify that --silent comes before dlx.
      expect(spawnArgs[0]).toBe('--silent')
      expect(spawnArgs[1]).toBe('dlx')
      expect(spawnArgs[2]).toBe('@coana-tech/cli@~1.0.0')
      expect(spawnArgs[3]).toBe('run')
      expect(spawnArgs[4]).toBe('/some/path')
    })

    it('should not add --silent for pnpm when silent is false', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], {
        agent: 'pnpm',
        silent: false,
      })

      expect(mockShadowPnpmBin).toHaveBeenCalledTimes(1)
      const [spawnArgs] = mockShadowPnpmBin.mock.calls[0]

      // Verify that --silent is not present.
      expect(spawnArgs[0]).toBe('dlx')
      expect(spawnArgs[1]).toBe('@coana-tech/cli@1.0.0')
      expect(spawnArgs[2]).toBe('run')
      expect(spawnArgs[3]).toBe('/some/path')
    })

    it('should default silent to true for pnpm when version is not pinned', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '~1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], { agent: 'pnpm' })

      expect(mockShadowPnpmBin).toHaveBeenCalledTimes(1)
      const [spawnArgs] = mockShadowPnpmBin.mock.calls[0]

      // Verify that --silent is automatically added for unpinned versions.
      expect(spawnArgs[0]).toBe('--silent')
      expect(spawnArgs[1]).toBe('dlx')
    })

    it('should place --silent after --yes for npm', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '~1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], {
        agent: 'npm',
        silent: true,
      })

      expect(mockShadowNpxBin).toHaveBeenCalledTimes(1)
      const [spawnArgs] = mockShadowNpxBin.mock.calls[0]

      // For npm/npx, --yes comes first, then --silent.
      expect(spawnArgs[0]).toBe('--yes')
      expect(spawnArgs[1]).toBe('--silent')
      expect(spawnArgs[2]).toBe('@coana-tech/cli@~1.0.0')
      expect(spawnArgs[3]).toBe('run')
      expect(spawnArgs[4]).toBe('/some/path')
    })

    it('should set npm_config_dlx_cache_max_age env var for pnpm when force is true', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], {
        agent: 'pnpm',
        force: true,
      })

      expect(mockShadowPnpmBin).toHaveBeenCalledTimes(1)
      const [, options] = mockShadowPnpmBin.mock.calls[0]

      // Verify that the env var is set to force cache bypass.
      expect(options.env).toBeDefined()
      expect(options.env.npm_config_dlx_cache_max_age).toBe('0')
    })

    it('should handle pinned version without silent flag by default', async () => {
      const packageSpec: DlxPackageSpec = {
        name: '@coana-tech/cli',
        version: '1.0.0',
      }

      await spawnDlx(packageSpec, ['run', '/some/path'], { agent: 'pnpm' })

      expect(mockShadowPnpmBin).toHaveBeenCalledTimes(1)
      const [spawnArgs] = mockShadowPnpmBin.mock.calls[0]

      // For pinned versions, silent defaults to false.
      expect(spawnArgs[0]).toBe('dlx')
      expect(spawnArgs[1]).toBe('@coana-tech/cli@1.0.0')
    })
  })
})
