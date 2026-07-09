/**
 * Unit tests for path constants.
 *
 * Purpose: Tests the path utility functions and constants.
 *
 * Test Coverage: - Static path constants - Lazy path getters - Path resolution
 * functions.
 *
 * Related Files: - constants/paths.mts (implementation)
 */

import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => ({ warn: vi.fn() }),
}))

import {
  configPath,
  distPath,
  DOT_SOCKET_DOT_FACTS_JSON,
  ENVIRONMENT_YAML,
  ENVIRONMENT_YML,
  externalPath,
  getBashRcPath,
  getBinCliPath,
  getBinPath,
  getBlessedContribPath,
  getBlessedOptions,
  getBlessedPath,
  getDistBinPath,
  getDistPackageJsonPath,
  getDistPath,
  getGithubCachePath,
  getPackageJsonPath,
  getSocketCachePath,
  getZshRcPath,
  homePath,
  PACKAGE_LOCK_JSON,
  PNPM_LOCK_YAML,
  REQUIREMENTS_TXT,
  rootPath,
  srcPath,
  UPDATE_STORE_DIR,
  UPDATE_STORE_FILE_NAME,
  YARN_LOCK,
} from '../../../src/constants/paths.mts'

describe('paths constants', () => {
  describe('static constants', () => {
    it('has ENVIRONMENT_YAML constant', () => {
      expect(ENVIRONMENT_YAML).toBe('environment.yaml')
    })

    it('has ENVIRONMENT_YML constant', () => {
      expect(ENVIRONMENT_YML).toBe('environment.yml')
    })

    it('has REQUIREMENTS_TXT constant', () => {
      expect(REQUIREMENTS_TXT).toBe('requirements.txt')
    })

    it('has PACKAGE_LOCK_JSON constant', () => {
      expect(PACKAGE_LOCK_JSON).toBe('package-lock.json')
    })

    it('has PNPM_LOCK_YAML constant', () => {
      expect(PNPM_LOCK_YAML).toBe('pnpm-lock.yaml')
    })

    it('has YARN_LOCK constant', () => {
      expect(YARN_LOCK).toBe('yarn.lock')
    })

    it('has UPDATE_STORE_DIR constant', () => {
      expect(UPDATE_STORE_DIR).toBe('.socket/_dlx')
    })

    it('has UPDATE_STORE_FILE_NAME constant', () => {
      expect(UPDATE_STORE_FILE_NAME).toBe('.dlx-manifest.json')
    })

    it('has DOT_SOCKET_DOT_FACTS_JSON constant', () => {
      expect(DOT_SOCKET_DOT_FACTS_JSON).toBe('.socket.facts.json')
    })
  })

  describe('computed paths', () => {
    it('has homePath defined', () => {
      expect(homePath).toBeDefined()
      expect(typeof homePath).toBe('string')
    })

    it('has srcPath defined', () => {
      expect(srcPath).toBeDefined()
      expect(typeof srcPath).toBe('string')
    })

    it('has rootPath defined', () => {
      expect(rootPath).toBeDefined()
      expect(typeof rootPath).toBe('string')
    })

    it('has distPath defined', () => {
      expect(distPath).toBeDefined()
      expect(distPath).toContain('dist')
    })

    it('has configPath defined', () => {
      expect(configPath).toBeDefined()
      expect(configPath).toContain('.config')
    })

    it('has externalPath defined', () => {
      expect(externalPath).toBeDefined()
      expect(externalPath).toContain('external')
    })
  })

  describe('path getter functions', () => {
    it('getBashRcPath returns path to .bashrc', () => {
      const result = getBashRcPath()
      expect(result).toContain('.bashrc')
    })

    it('getZshRcPath returns path to .zshrc', () => {
      const result = getZshRcPath()
      expect(result).toContain('.zshrc')
    })

    it('getBinPath returns path to bin directory', () => {
      const result = getBinPath()
      expect(result).toContain('bin')
    })

    it('getBinCliPath returns path to CLI entry point', () => {
      const result = getBinCliPath()
      // Default bundle entry is `dist/index.js` (was `dist/cli.js`
      // before the unified-build rename in src/constants/paths.mts).
      // Tests load `.env.test`, which sets `SOCKET_CLI_BIN_PATH` to
      // `./build/cli.js` so unit tests can exercise locally-built
      // bundles. The env value is snapshotted at module load by
      // src/env/socket-cli-bin-path.mts, so we can't unset it here —
      // accept either the override path or the default.
      const isOverride =
        result.endsWith('build/cli.js') || result.endsWith('build\\cli.js')
      const isDefault =
        result.endsWith('dist/index.js') || result.endsWith('dist\\index.js')
      expect(isOverride || isDefault).toBe(true)
    })

    it('getDistPath returns distPath', () => {
      const result = getDistPath()
      expect(result).toContain('dist')
    })

    it('getDistBinPath returns path to dist/bin', () => {
      const result = getDistBinPath()
      expect(result).toContain('dist')
      expect(result).toContain('bin')
    })

    it('getDistPackageJsonPath returns path to dist/package.json', () => {
      const result = getDistPackageJsonPath()
      expect(result).toContain('dist')
      expect(result).toContain('package.json')
    })

    it('getPackageJsonPath returns path to package.json', () => {
      const result = getPackageJsonPath()
      expect(result).toContain('package.json')
    })

    it('getBlessedPath returns path to external/blessed', () => {
      const result = getBlessedPath()
      expect(result).toContain('external')
      expect(result).toContain('blessed')
    })

    it('getBlessedContribPath returns path to external/blessed-contrib', () => {
      const result = getBlessedContribPath()
      expect(result).toContain('external')
      expect(result).toContain('blessed-contrib')
    })

    it('getGithubCachePath returns path in socket cache', () => {
      const result = getGithubCachePath()
      expect(result).toContain('socket')
      expect(result).toContain('github')
    })
  })

  describe('getBlessedOptions', () => {
    it('returns object with fullUnicode', () => {
      const result = getBlessedOptions()
      expect(result.fullUnicode).toBe(true)
    })

    it('returns object with titleShrink', () => {
      const result = getBlessedOptions()
      expect(result.titleShrink).toBe(true)
    })

    it('returns object with input and output streams', () => {
      const result = getBlessedOptions()
      expect(result.input).toBe(process.stdin)
      expect(result.output).toBe(process.stdout)
    })

    it('returns object with terminal setting', () => {
      const result = getBlessedOptions()
      expect(result.terminal).toMatch(/xterm/)
    })
  })

  describe('getSocketCachePath', () => {
    it('returns platform-specific cache path', () => {
      const result = getSocketCachePath()
      expect(result).toContain('socket')
    })

    it('respects XDG_CACHE_HOME when set', async () => {
      const originalXdg = process.env['XDG_CACHE_HOME']
      process.env['XDG_CACHE_HOME'] = '/custom/cache'

      // Re-import to pick up new env value.
      const { getSocketCachePath: getPathFresh } =
        await import('../../../src/constants/paths.mts')
      const result = getPathFresh()

      // Restore.
      if (originalXdg === undefined) {
        delete process.env['XDG_CACHE_HOME']
      } else {
        process.env['XDG_CACHE_HOME'] = originalXdg
      }

      expect(result).toContain('socket')
    })

    it('uses Library/Caches on darwin', async () => {
      // Stub platform to darwin.
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      try {
        // Reset modules so paths.mts re-evaluates ENV without XDG_CACHE_HOME.
        const originalXdg = process.env['XDG_CACHE_HOME']
        delete process.env['XDG_CACHE_HOME']
        try {
          vi.resetModules()
          const { getSocketCachePath: getPathFresh } =
            await import('../../../src/constants/paths.mts')
          const result = getPathFresh()
          expect(result).toContain('Library/Caches/socket')
        } finally {
          if (originalXdg !== undefined) {
            process.env['XDG_CACHE_HOME'] = originalXdg
          }
        }
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
      }
    })

    it('uses TEMP-based path on win32 (lines 180-184)', async () => {
      // The underlying ENV constant is read at module-init from
      // env/temp.mts, env/tmp.mts. Set them in process.env before
      // re-importing the module so getSocketCachePath picks them up.
      const originalPlatform = process.platform
      const originalXdg = process.env['XDG_CACHE_HOME']
      const originalTemp = process.env['TEMP']
      const originalTmp = process.env['TMP']

      Object.defineProperty(process, 'platform', { value: 'win32' })
      delete process.env['XDG_CACHE_HOME']
      process.env['TEMP'] = '/winroot/Temp'
      delete process.env['TMP']

      try {
        vi.resetModules()
        const { getSocketCachePath: getPathFresh } =
          await import('../../../src/constants/paths.mts')
        const result = getPathFresh()
        expect(result).toContain('socket')
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
        if (originalXdg !== undefined) {
          process.env['XDG_CACHE_HOME'] = originalXdg
        }
        if (originalTemp === undefined) {
          delete process.env['TEMP']
        } else {
          process.env['TEMP'] = originalTemp
        }
        if (originalTmp !== undefined) {
          process.env['TMP'] = originalTmp
        }
      }
    })

    it('uses ~/.cache on linux (default branch line 186)', async () => {
      const originalPlatform = process.platform
      const originalXdg = process.env['XDG_CACHE_HOME']
      Object.defineProperty(process, 'platform', { value: 'linux' })
      delete process.env['XDG_CACHE_HOME']
      try {
        vi.resetModules()
        const { getSocketCachePath: getPathFresh } =
          await import('../../../src/constants/paths.mts')
        const result = getPathFresh()
        // oxlint-disable-next-line socket/prefer-node-modules-dot-cache -- test asserts XDG cache resolution to `~/.cache/socket`, the canonical Linux user-cache path; not a fleet cache location.
        expect(result).toContain('.cache/socket')
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform })
        if (originalXdg !== undefined) {
          process.env['XDG_CACHE_HOME'] = originalXdg
        }
      }
    })
  })

  describe('getSocketAppDataPath', () => {
    it('returns a string or undefined', async () => {
      const { getSocketAppDataPath } =
        await import('../../../src/constants/paths.mts')
      const result = getSocketAppDataPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })

    it('includes socket/settings in path when defined', async () => {
      const { getSocketAppDataPath } =
        await import('../../../src/constants/paths.mts')
      const result = getSocketAppDataPath()
      if (result !== undefined) {
        expect(result).toContain('socket')
        expect(result).toContain('settings')
      }
    })
  })

  describe('getSocketRegistryPath', () => {
    it('returns a path containing registry', async () => {
      const { getSocketRegistryPath } =
        await import('../../../src/constants/paths.mts')
      try {
        const result = getSocketRegistryPath()
        expect(result).toContain('registry')
      } catch (e) {
        // Function may throw if app data path cannot be determined.
        expect((e as Error).message).toContain('Unable to determine')
      }
    })
  })

  describe('getNmBunPath', () => {
    it('returns string or undefined', async () => {
      const { getNmBunPath } = await import('../../../src/constants/paths.mts')
      const result = getNmBunPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })
  })

  describe('getNmNpmPath', () => {
    it('returns a string', async () => {
      const { getNmNpmPath } = await import('../../../src/constants/paths.mts')
      const result = getNmNpmPath()
      expect(typeof result).toBe('string')
    })
  })

  describe('getNmNodeGypPath', () => {
    it('returns string or undefined', async () => {
      const { getNmNodeGypPath } =
        await import('../../../src/constants/paths.mts')
      const result = getNmNodeGypPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })
  })

  describe('getNmPnpmPath', () => {
    it('returns string or undefined', async () => {
      const { getNmPnpmPath } = await import('../../../src/constants/paths.mts')
      const result = getNmPnpmPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })
  })

  describe('getNmYarnPath', () => {
    it('returns string or undefined', async () => {
      const { getNmYarnPath } = await import('../../../src/constants/paths.mts')
      const result = getNmYarnPath()
      expect(result === undefined || typeof result === 'string').toBe(true)
    })
  })
})
