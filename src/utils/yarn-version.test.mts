import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies.
vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawnSync: vi.fn(),
}))

vi.mock('./yarn-paths.mts', () => ({
  getYarnBinPath: vi.fn(),
}))

vi.mock('../constants.mts', () => ({
  default: {
    WIN32: false,
  },
  FLAG_VERSION: '--version',
  UTF8: 'utf8',
}))

describe('yarn-version utilities', () => {
  let isYarnBerry: typeof import('./yarn-version.mts')['isYarnBerry']

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()

    // Re-import function after module reset to clear cache
    const yarnVersion = await import('./yarn-version.mts')
    isYarnBerry = yarnVersion.isYarnBerry
  })

  describe('isYarnBerry', () => {
    it('returns true for Yarn 2.x', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '2.4.3',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(true)
      expect(spawnSync).toHaveBeenCalledWith(
        '/usr/local/bin/yarn',
        ['--version'],
        {
          shell: false,
        },
      )
    })

    it('returns true for Yarn 3.x', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '3.6.4',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(true)
    })

    it('returns true for Yarn 4.x', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '4.0.2',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(true)
    })

    it('returns false for Yarn Classic (1.x)', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '1.22.19',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when yarn command fails', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'Command failed',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when yarn returns no output', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('handles malformed version strings', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: 'invalid-version',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when getYarnBinPath throws', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockImplementation(() => {
        throw new Error('Yarn not found')
      })

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('returns false when spawnSync throws', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockImplementation(() => {
        throw new Error('Spawn failed')
      })

      const result = isYarnBerry()

      expect(result).toBe(false)
    })

    it('uses shell on Windows', async () => {
      const constants = vi.mocked(await import('../constants.mts'))
      constants.default.WIN32 = true

      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('C:\\Program Files\\yarn\\yarn.cmd')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '2.4.3',
        stderr: '',
      } as any)

      const result = isYarnBerry()

      expect(result).toBe(true)
      expect(spawnSync).toHaveBeenCalledWith(
        'C:\\Program Files\\yarn\\yarn.cmd',
        ['--version'],
        {
          shell: true,
        },
      )
    })

    it('caches the result', async () => {
      const { getYarnBinPath } = vi.mocked(await import('./yarn-paths.mts'))
      getYarnBinPath.mockReturnValue('/usr/local/bin/yarn')

      const { spawnSync } = vi.mocked(
        await import('@socketsecurity/registry/lib/spawn'),
      )
      spawnSync.mockReturnValue({
        status: 0,
        stdout: '3.0.0',
        stderr: '',
      } as any)

      const result1 = isYarnBerry()
      const result2 = isYarnBerry()
      const result3 = isYarnBerry()

      expect(result1).toBe(true)
      expect(result2).toBe(true)
      expect(result3).toBe(true)
      expect(spawnSync).toHaveBeenCalledTimes(1)
    })
  })
})
