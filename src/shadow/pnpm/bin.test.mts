import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import shadowPnpm from './bin.mts'
import { FLAG_DRY_RUN } from '../../constants/cli.mts'

// Mock fs module
vi.mock('node:fs', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      readFile: vi.fn(),
    },
  }
})

// Mock all dependencies with vi.hoisted for better type safety
const mockInstallPnpmLinks = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockGetAlertsMapFromPurls = vi.hoisted(() => vi.fn())
const mockGetAlertsMapFromPnpmLockfile = vi.hoisted(() => vi.fn())
const mockParsePnpmLockfile = vi.hoisted(() => vi.fn())
const mockReadPnpmLockfile = vi.hoisted(() => vi.fn())
const mockLogAlertsMap = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())

vi.mock('../../utils/socket/alerts.mts', () => ({
  getAlertsMapFromPnpmLockfile: mockGetAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls: mockGetAlertsMapFromPurls,
}))

vi.mock('../../utils/pnpm.mts', () => ({
  parsePnpmLockfile: mockParsePnpmLockfile,
  readPnpmLockfile: mockReadPnpmLockfile,
}))

vi.mock('../../utils/socket/package-alert.mts', () => ({
  logAlertsMap: mockLogAlertsMap,
}))

vi.mock('../../utils/shadow/links.mts', () => ({
  installPnpmLinks: mockInstallPnpmLinks,
}))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      shadowBinPath: '/mock/shadow-bin',
      ENV: new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'SOCKET_CLI_ACCEPT_RISKS') {
              return process.env['SOCKET_CLI_ACCEPT_RISKS'] || ''
            }
            if (prop === 'SOCKET_CLI_VIEW_ALL_RISKS') {
              return process.env['SOCKET_CLI_VIEW_ALL_RISKS'] || ''
            }
            return ''
          },
        },
      ),
    },
  }
})

describe('shadowPnpm', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockInstallPnpmLinks.mockResolvedValue('/usr/bin/pnpm')
    mockSpawn.mockReturnValue({
      process: {
        send: vi.fn(),
        on: vi.fn(),
      },
      then: vi.fn().mockImplementation(cb =>
        cb({
          success: true,
          code: 0,
          stdout: '',
          stderr: '',
        }),
      ),
    })
    mockGetAlertsMapFromPurls.mockResolvedValue(new Map())
    mockExistsSync.mockReturnValue(false)

    // Mock process.env
    process.env['SOCKET_CLI_ACCEPT_RISKS'] = ''
    process.env['SOCKET_CLI_VIEW_ALL_RISKS'] = ''
  })

  afterEach(() => {
    delete process.env['SOCKET_CLI_ACCEPT_RISKS']
    delete process.env['SOCKET_CLI_VIEW_ALL_RISKS']
  })

  it('should handle pnpm add with single package', async () => {
    const result = await shadowPnpm(['add', 'lodash'])

    expect(mockInstallPnpmLinks).toHaveBeenCalledWith(expect.any(String))
    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash'],
      expect.objectContaining({
        nothrow: true,
        filter: { actions: ['error', 'monitor', 'warn'] },
      }),
    )
    expect(result).toHaveProperty('spawnPromise')
  })

  it('should handle pnpm add with versioned package', async () => {
    await shadowPnpm(['add', 'lodash@4.17.21'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash@4.17.21'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle pnpm add with scoped package', async () => {
    await shadowPnpm(['add', '@types/node'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/@types/node'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle pnpm add with scoped package and version', async () => {
    await shadowPnpm(['add', '@types/node@20.0.0'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/@types/node@20.0.0'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle multiple packages', async () => {
    await shadowPnpm(['add', 'lodash', 'axios@1.0.0', '@types/node'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash', 'pkg:npm/axios@1.0.0', 'pkg:npm/@types/node'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should skip scanning for install without lockfile', async () => {
    mockExistsSync.mockReturnValue(false)

    await shadowPnpm(['install'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should exit with code 1 when risks are found', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    mockGetAlertsMapFromPurls.mockResolvedValue(
      new Map([
        [
          'pkg:npm/malicious-package',
          [{ action: 'error', description: 'Malicious code detected' }],
        ],
      ]),
    )

    await expect(shadowPnpm(['add', 'malicious-package'])).rejects.toThrow(
      'process.exit called',
    )
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
  })

  it('should respect SOCKET_CLI_ACCEPT_RISKS environment variable', async () => {
    process.env['SOCKET_CLI_ACCEPT_RISKS'] = '1'

    await shadowPnpm(['add', 'lodash'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash'],
      expect.objectContaining({
        filter: { actions: ['error'], blocked: true },
      }),
    )
  })

  it('should handle dry-run flag by skipping scanning', async () => {
    await shadowPnpm(['add', 'lodash', FLAG_DRY_RUN])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should handle non-install commands without scanning', async () => {
    await shadowPnpm(['run', 'test'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should filter out command line flags from package names', async () => {
    await shadowPnpm(['add', 'lodash', '--save-dev', 'axios', '--'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash', 'pkg:npm/axios'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })
})
