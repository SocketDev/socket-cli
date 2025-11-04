/**
 * Unit tests for yarn shadow binary wrapper.
 *
 * Tests the yarn-specific shadow binary that provides security scanning for
 * yarn package manager commands (add, install, upgrade, dlx).
 *
 * Test Coverage:
 * - yarn add with single package
 * - yarn add with versioned package (lodash@4.17.21)
 * - yarn add with scoped package (@types/node)
 * - yarn add with scoped package and version (@types/node@20.0.0)
 * - yarn dlx command (execute package without installing)
 * - Multiple packages in single command
 * - yarn install scanning dependencies from package.json
 * - Process exit with code 1 when risks found
 * - SOCKET_CLI_ACCEPT_RISKS environment variable (changes filter to errors only)
 * - Dry-run flag (skips scanning)
 * - Non-install commands (run, test) without scanning
 * - Filtering command line flags from package names
 * - yarn upgrade command by scanning package.json
 * - Continue on package.json read error
 *
 * Testing Approach:
 * - Mock spawn, readPackageJson, alert fetching
 * - Mock shadow link installation
 * - Test PURL generation from package specs
 * - Validate alert filtering based on risk acceptance
 * - Test process.exit behavior on security violations
 * - Test package.json dependency scanning for install/upgrade
 *
 * Related Files:
 * - src/shadow/yarn/bin.mts - yarn shadow binary implementation
 * - src/utils/socket/alerts.mts - Alert fetching
 * - src/utils/shadow/links.mts - Shadow binary link management
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FLAG_DRY_RUN } from '../../../../src/constants/cli.mts'
import shadowYarn from '../../../../src/shadow/yarn/bin.mts'

// Mock readPackageJson from registry
const mockReadPackageJson = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/lib/packages', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    readPackageJson: mockReadPackageJson,
  }
})

// Mock all dependencies with vi.hoisted for better type safety
const mockInstallYarnLinks = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())
const mockGetAlertsMapFromPurls = vi.hoisted(() => vi.fn())
const mockLogAlertsMap = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/socket/alerts.mts', () => ({
  getAlertsMapFromPurls: mockGetAlertsMapFromPurls,
}))

vi.mock('../../../../src/utils/socket/package-alert.mts', () => ({
  logAlertsMap: mockLogAlertsMap,
}))

vi.mock('../../../../src/utils/shadow/links.mts', () => ({
  installYarnLinks: mockInstallYarnLinks,
}))

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../../../../src/constants.mts', async importOriginal => {
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

describe('shadowYarn', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockInstallYarnLinks.mockResolvedValue('/usr/bin/yarn')
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
    mockReadPackageJson.mockResolvedValue({ dependencies: {} })

    // Mock process.env
    process.env['SOCKET_CLI_ACCEPT_RISKS'] = ''
    process.env['SOCKET_CLI_VIEW_ALL_RISKS'] = ''
  })

  afterEach(() => {
    delete process.env['SOCKET_CLI_ACCEPT_RISKS']
    delete process.env['SOCKET_CLI_VIEW_ALL_RISKS']
  })

  it('should handle yarn add with single package', async () => {
    const result = await shadowYarn(['add', 'lodash'])

    expect(mockInstallYarnLinks).toHaveBeenCalledWith(expect.any(String))
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
    mockReadPackageJson.mockResolvedValue({
      dependencies: {
        lodash: '^4.17.21',
        axios: '~1.0.0',
      },
      devDependencies: {
        '@types/node': '^20.0.0',
      },
    })

    await shadowYarn(['install'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      [
        'pkg:npm/lodash@%5E4.17.21',
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
    process.env['SOCKET_CLI_ACCEPT_RISKS'] = '1'

    await shadowYarn(['add', 'lodash'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/lodash'],
      expect.objectContaining({
        filter: { actions: ['error'], blocked: true },
        nothrow: true,
      }),
    )
  })

  it('should handle dry-run flag by skipping scanning', async () => {
    await shadowYarn(['add', 'lodash', FLAG_DRY_RUN])

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
    mockReadPackageJson.mockResolvedValue({
      dependencies: {
        react: '^18.0.0',
      },
    })

    await shadowYarn(['upgrade'])

    expect(mockGetAlertsMapFromPurls).toHaveBeenCalledWith(
      ['pkg:npm/react@%5E18.0.0'],
      expect.objectContaining({
        nothrow: true,
      }),
    )
  })

  it('should continue on package.json read error', async () => {
    mockReadPackageJson.mockRejectedValue(new Error('File not found'))

    await shadowYarn(['install'])

    expect(mockGetAlertsMapFromPurls).not.toHaveBeenCalled()
  })
})
