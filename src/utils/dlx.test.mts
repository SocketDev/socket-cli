import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../constants.mts'
import { spawnCoanaDlx, spawnDlx } from './dlx.mts'

import type { DlxPackageSpec } from './dlx.mts'

const require = createRequire(import.meta.url)

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: vi.fn(),
}))

vi.mock('./sdk.mts', () => ({
  getDefaultApiToken: () => undefined,
  getDefaultProxyUrl: () => undefined,
}))

vi.mock('../commands/ci/fetch-default-org-slug.mts', () => ({
  getDefaultOrgSlug: async () => ({ ok: false }),
}))

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
        version: '1.0.0',
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
      expect(spawnArgs[2]).toBe('@coana-tech/cli@1.0.0')
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
        version: '1.0.0',
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
      expect(spawnArgs[2]).toBe('@coana-tech/cli@1.0.0')
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

  describe('spawnCoanaDlx npm-install fallback', () => {
    const mockSpawn = vi.mocked(spawn)
    let mockDlxBin: ReturnType<typeof vi.fn>
    let installRoot: string
    let testCounter = 0

    // Each test picks a unique version so they don't share the module-level
    // install cache.
    const nextVersion = () => `99.0.${testCounter++}`

    // Swap the shadow-bin mock to reject with a specific error shape.
    // Default beforeEach uses code: 249 / stderr: 'npx aborted'.
    const setDlxRejection = (err: Record<string, unknown>) => {
      mockDlxBin.mockReset()
      mockDlxBin.mockImplementation(async () => {
        const rejected = Promise.reject(
          Object.assign(new Error('dlx exploded'), err),
        )
        rejected.catch(() => {})
        return { spawnPromise: rejected }
      })
    }

    beforeEach(async () => {
      delete process.env['SOCKET_CLI_COANA_FORCE_NPM_INSTALL']
      delete process.env['SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK']
      delete process.env['SOCKET_CLI_COANA_LOCAL_PATH']

      installRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'socket-coana-test-'),
      )

      // By default, make whichever shadow bin spawnDlx auto-selects fail so
      // the catch path runs. spawnDlx detects the project's PM by lockfile, so
      // we mock all three (npm/pnpm/yarn) to the same failing behavior.
      // Use mockImplementation so a fresh rejected promise is created per call
      // and attach a no-op .catch to suppress Node's unhandled-rejection
      // warning (the real handler attaches a microtask later inside the SUT).
      mockDlxBin = vi.fn().mockImplementation(async () => {
        const rejected = Promise.reject(
          Object.assign(new Error('dlx exploded'), {
            code: 249,
            stderr: 'npx aborted',
          }),
        )
        rejected.catch(() => {})
        return { spawnPromise: rejected }
      })
      for (const binPath of [
        constants.shadowNpxBinPath,
        constants.shadowPnpmBinPath,
        constants.shadowYarnBinPath,
      ]) {
        // @ts-ignore
        require.cache[binPath] = { exports: mockDlxBin }
      }

      // Default behavior: spawn() succeeds for both `npm install` (writing a
      // realistic node_modules/@coana-tech/cli/package.json into the tmp
      // install dir) and `node` (returning empty stdout). Tests override per
      // case via .mockImplementationOnce.
      mockSpawn.mockReset()
      mockSpawn.mockImplementation(async (cmd: string, args: string[]) => {
        if (cmd === 'npm' && args[0] === 'install') {
          // Pull --prefix out of args to find the install dir.
          const prefixIdx = args.indexOf('--prefix')
          const installDir = args[prefixIdx + 1]
          const pkgDir = path.join(
            installDir,
            'node_modules',
            '@coana-tech',
            'cli',
          )
          await fs.mkdir(pkgDir, { recursive: true })
          await fs.writeFile(
            path.join(pkgDir, 'package.json'),
            JSON.stringify({ bin: { coana: 'dist/cli.js' } }),
          )
          return { stdout: '', stderr: '' }
        }
        // node <script> ...
        return { stdout: 'coana-ok', stderr: '' }
      })
    })

    afterEach(async () => {
      for (const binPath of [
        constants.shadowNpxBinPath,
        constants.shadowPnpmBinPath,
        constants.shadowYarnBinPath,
      ]) {
        // @ts-ignore
        delete require.cache[binPath]
      }
      vi.restoreAllMocks()
      mockSpawn.mockReset()
      delete process.env['SOCKET_CLI_COANA_FORCE_NPM_INSTALL']
      delete process.env['SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK']
      await fs.rm(installRoot, { recursive: true, force: true })
    })

    it('falls back to npm install + node when dlx throws', async () => {
      const version = nextVersion()
      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: version,
      })

      expect(result.ok).toBe(true)
      expect(mockDlxBin).toHaveBeenCalledTimes(1)

      // npm install was invoked with the expected version.
      const npmCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmCalls).toHaveLength(1)
      expect((npmCalls[0]![1] as string[]).at(-1)).toBe(
        `@coana-tech/cli@${version}`,
      )

      // node was then invoked with the resolved bin and the user's args.
      const nodeCalls = mockSpawn.mock.calls.filter(([cmd]) => cmd === 'node')
      expect(nodeCalls).toHaveLength(1)
      const nodeArgs = nodeCalls[0]![1] as string[]
      expect(nodeArgs[0]).toMatch(/dist[\\/]cli\.js$/)
      expect(nodeArgs.slice(1)).toEqual(['run', '.'])
    })

    it('caches the install across calls with the same version', async () => {
      const version = nextVersion()
      const r1 = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: version,
      })
      const r2 = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: version,
      })

      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)

      // Only one npm install — second call reuses the cached path.
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(1)
      // But two node spawns — one per invocation.
      const nodeCalls = mockSpawn.mock.calls.filter(([cmd]) => cmd === 'node')
      expect(nodeCalls).toHaveLength(2)
    })

    it('skips fallback when SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK is set', async () => {
      process.env['SOCKET_CLI_COANA_DISABLE_NPM_FALLBACK'] = '1'

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Coana command failed')
      // No npm install was attempted.
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(0)
    })

    it('skips dlx and goes straight to install when SOCKET_CLI_COANA_FORCE_NPM_INSTALL is set', async () => {
      process.env['SOCKET_CLI_COANA_FORCE_NPM_INSTALL'] = '1'

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(true)
      // dlx (any shadow bin) was never invoked.
      expect(mockDlxBin).not.toHaveBeenCalled()
      // npm install ran.
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(1)
    })

    it('surfaces both dlx and install errors when fallback install fails', async () => {
      // Make npm install fail; node would not be reached.
      mockSpawn.mockImplementation(async (cmd: string) => {
        if (cmd === 'npm') {
          throw Object.assign(new Error('install boom'), {
            stderr: 'registry unreachable',
          })
        }
        return { stdout: '', stderr: '' }
      })

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('Coana command failed')
      expect(result.message).toContain('npx aborted')
      expect(result.message).toContain('npm-install fallback also failed')
      expect(result.message).toContain('registry unreachable')
    })

    it('does NOT fall back on small integer exit codes (likely real Coana failures)', async () => {
      // Coana ran and exited with code 1 — a real analysis failure. We want
      // the dlx error to propagate as-is without triggering an install retry.
      setDlxRejection({ code: 1, stderr: '' })

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(false)
      expect(result.message).toContain('exit code 1')
      // No npm install was attempted.
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(0)
    })

    it('does NOT fall back when captured stderr shows Coana booted', async () => {
      // Coana banner present in stderr → Coana clearly ran, so any subsequent
      // failure is a real Coana issue, not a launcher problem.
      setDlxRejection({
        code: 137,
        stderr:
          '2026-05-22 09:31:34.817 - info: Coana CLI version 15.3.4 scan initiated on .\nfatal: out of memory',
      })

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(false)
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(0)
    })

    it('falls back on spawn-level errors (ENOENT-style)', async () => {
      // npx itself missing from PATH — code is a string, not a number.
      setDlxRejection({ code: 'ENOENT' })

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(true)
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(1)
    })

    it('falls back when process was killed by signal', async () => {
      setDlxRejection({ code: null, signal: 'SIGKILL' })

      const result = await spawnCoanaDlx(['run', '.'], 'acme', {
        coanaVersion: nextVersion(),
      })

      expect(result.ok).toBe(true)
      const npmInstallCalls = mockSpawn.mock.calls.filter(
        ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
      )
      expect(npmInstallCalls).toHaveLength(1)
    })

    it('strips npm_package_* env vars in the fallback to avoid E2BIG in big monorepos', async () => {
      // Simulate a parent env polluted with npm_package_* (as set by npm/pnpm
      // when running inside a project with a populated package.json). The
      // fallback must not pass these through to its npm install or node
      // spawns, or the same ARG_MAX overflow that broke the dlx path would
      // recur.
      process.env['npm_package_name'] = 'forge'
      process.env['npm_package_dependencies_react'] = '^18.2.0'
      process.env['npm_package_devDependencies_typescript'] = '^5.0.0'
      // npm_config_* must be preserved — these carry registry/proxy settings
      // sourced from .npmrc and are needed for the nested npm install.
      process.env['npm_config_registry'] = 'https://artifactory.example/npm/'

      try {
        const result = await spawnCoanaDlx(['run', '.'], 'acme', {
          coanaVersion: nextVersion(),
        })
        expect(result.ok).toBe(true)

        const npmInstallCall = mockSpawn.mock.calls.find(
          ([cmd, args]) => cmd === 'npm' && (args as string[])[0] === 'install',
        )!
        const nodeCall = mockSpawn.mock.calls.find(([cmd]) => cmd === 'node')!

        const npmEnv = (npmInstallCall[2] as { env: NodeJS.ProcessEnv }).env
        const nodeEnv = (nodeCall[2] as { env: NodeJS.ProcessEnv }).env

        // npm_package_* are stripped from both spawns.
        expect(npmEnv['npm_package_name']).toBeUndefined()
        expect(npmEnv['npm_package_dependencies_react']).toBeUndefined()
        expect(npmEnv['npm_package_devDependencies_typescript']).toBeUndefined()
        expect(nodeEnv['npm_package_name']).toBeUndefined()
        expect(nodeEnv['npm_package_dependencies_react']).toBeUndefined()

        // npm_config_* is preserved (registry override survives).
        expect(npmEnv['npm_config_registry']).toBe(
          'https://artifactory.example/npm/',
        )
        expect(nodeEnv['npm_config_registry']).toBe(
          'https://artifactory.example/npm/',
        )
      } finally {
        delete process.env['npm_package_name']
        delete process.env['npm_package_dependencies_react']
        delete process.env['npm_package_devDependencies_typescript']
        delete process.env['npm_config_registry']
      }
    })
  })
})
