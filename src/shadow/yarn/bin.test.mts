import { promises as fs } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import shadowYarn from './bin.mts'

// Mock fs module
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    promises: {
      readFile: mockFsReadFile,
    },
  }
})

// Mock all dependencies with vi.hoisted for better type safety
const mockInstallLinks = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockGetAlertsMapFromPurls = vi.hoisted(() => vi.fn())
const mockLogAlertsMap = vi.hoisted(() => vi.fn())
const mockFsReadFile = vi.hoisted(() => vi.fn())

vi.mock('../../utils/alerts-map.mts', () => ({
  getAlertsMapFromPurls: mockGetAlertsMapFromPurls,
}))

vi.mock('../../utils/socket-package-alert.mts', () => ({
  logAlertsMap: mockLogAlertsMap,
}))

vi.mock('./link.mts', () => ({
  installLinks: mockInstallLinks,
}))

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: {
      ...actual.default,
      shadowBinPath: '/mock/shadow-bin',
      ENV: {
        SOCKET_CLI_ACCEPT_RISKS: '',
        SOCKET_CLI_VIEW_ALL_RISKS: '',
      },
    },
  }
})

describe('shadowYarn', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockInstallLinks.mockResolvedValue('/usr/bin/yarn')
    mockSpawn.mockResolvedValue({
      success: true,
      code: 0,
      stdout: '',
      stderr: '',
    })
    mockGetAlertsMapFromPurls.mockResolvedValue(new Map())
    mockFsReadFile.mockResolvedValue('{"dependencies": {}}')

    // Mock process.env
    process.env.SOCKET_CLI_ACCEPT_RISKS = ''
    process.env.SOCKET_CLI_VIEW_ALL_RISKS = ''
  })

  afterEach(() => {
    delete process.env.SOCKET_CLI_ACCEPT_RISKS
    delete process.env.SOCKET_CLI_VIEW_ALL_RISKS
  })

  it('should handle yarn add with single package', async () => {
    const result = await shadowYarn(['add', 'lodash'])

    expect(mockInstallLinks).toHaveBeenCalledWith(expect.any(String), 'yarn')
    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash'],
      expect.objectContaining({
        nothrow: true,
        filter: { actions: ['error', 'monitor', 'warn'] },
      }),
    )
    expect(result).toHaveProperty('spawnPromise')
  })

  it('should handle yarn add with versioned package', async () => {
    await shadowYarn(['add', 'lodash@4.17.21'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash@4.17.21'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle yarn add with scoped package', async () => {
    await shadowYarn(['add', '@types/node'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/@types/node'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle yarn add with scoped package and version', async () => {
    await shadowYarn(['add', '@types/node@20.0.0'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/@types/node@20.0.0'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle yarn dlx command', async () => {
    await shadowYarn(['dlx', 'cowsay@1.6.0'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/cowsay@1.6.0'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle multiple packages', async () => {
    await shadowYarn(['add', 'lodash', 'axios@1.0.0', '@types/node'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash', 'pkg:npm/axios@1.0.0', 'pkg:npm/@types/node'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should scan dependencies from package.json for install command', async () => {
    mockFsReadFile.mockResolvedValue(
      JSON.stringify({
        dependencies: {
          lodash: '^4.17.21',
          axios: '~1.0.0',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
        },
      }),
    )

    await shadowYarn(['install'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      [
        'pkg:npm/lodash@^4.17.21',
        'pkg:npm/axios@~1.0.0',
        'pkg:npm/@types/node@^20.0.0',
      ],
      expect.objectContaining({
        nothrow: true,
      }),
    )
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

    await expect(shadowYarn(['add', 'malicious-package'])).rejects.toThrow(
      'process.exit called',
    )
    expect(mockExit).toHaveBeenCalledWith(1)

    mockExit.mockRestore()
  })

  it('should respect SOCKET_CLI_ACCEPT_RISKS environment variable', async () => {
    process.env.SOCKET_CLI_ACCEPT_RISKS = '1'

    await shadowYarn(['add', 'lodash'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash'],
      expect.objectContaining({
        filter: { actions: ['error'], blocked: true },
      }),
    )
  })

  it('should handle dry-run flag by skipping scanning', async () => {
    await shadowYarn(['add', 'lodash', '--dry-run'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should handle non-install commands without scanning', async () => {
    await shadowYarn(['run', 'test'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })

  it('should filter out command line flags from package names', async () => {
    await shadowYarn(['add', 'lodash', '--save-dev', 'axios', '--'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash', 'pkg:npm/axios'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should handle upgrade command by scanning package.json', async () => {
    mockFsReadFile.mockResolvedValue(
      JSON.stringify({
        dependencies: {
          react: '^18.0.0',
        },
      }),
    )

    await shadowYarn(['upgrade'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/react@^18.0.0'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should continue on package.json read error', async () => {
    mockFsReadFile.mockRejectedValue(new Error('File not found'))

    await shadowYarn(['install'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })
})
