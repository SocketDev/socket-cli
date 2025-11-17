/**
 * Unit tests for npm shadow binary base implementation.
 *
 * Tests the core shadow binary functionality that wraps npm/npx commands with
 * Socket security scanning via IPC communication and Node.js permissions.
 *
 * Test Coverage:
 * - npm spawn with default arguments (--no-audit, --no-fund, --no-progress, --loglevel error)
 * - npx spawn with correct binary path
 * - Custom cwd option handling (string and URL)
 * - stdio option preservation
 * - Permission flags for npm on supported Node.js versions
 * - No permission flags for npx
 * - Preserving existing --node-options
 * - Filtering audit and progress flags
 * - Terminator args (--) handling
 * - IPC handshake message with API token
 * - Progress flag in IPC message
 * - Shadow link installation (npm/npx)
 * - Node.js hardening flags (--frozen-intrinsics, --no-warnings)
 * - Inject script loading (--require)
 *
 * Testing Approach:
 * - Mock spawnNode, findSystemNodejsSync, link installers
 * - Mock constants (paths, shadow, env, node)
 * - Validate spawn arguments and options
 * - Test IPC data structure
 * - Verify Node.js security flags
 *
 * Related Files:
 * - src/shadow/npm-base.mts - Base npm shadow implementation
 * - src/utils/spawn/spawn-node.mts - Node.js process spawning
 * - src/utils/shadow/links.mts - Shadow binary link management
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NPM, NPX } from '@socketsecurity/lib/constants/agents'

import shadowNpmBase from '../../../src/shadow/npm-base.mts'

import type { ShadowBinOptions } from '../../../src/shadow/npm-base.mts'

// Mock all dependencies.
const mockSpawnNode = vi.hoisted(() => vi.fn())
const mockFindSystemNodejsSync = vi.hoisted(() => vi.fn())
const mockIsSeaBinary = vi.hoisted(() => vi.fn())
const mockInstallNpmLinks = vi.hoisted(() => vi.fn())
const mockInstallNpxLinks = vi.hoisted(() => vi.fn())
const mockGetPublicApiToken = vi.hoisted(() => vi.fn())
const mockFindUp = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
    },
  }
})

vi.mock('../../../src/utils/spawn/spawn-node.mts', () => ({
  spawnNode: mockSpawnNode,
  findSystemNodejsSync: mockFindSystemNodejsSync,
}))

vi.mock('../../../src/utils/sea/detect.mts', () => ({
  isSeaBinary: mockIsSeaBinary,
}))

vi.mock('../../../src/utils/shadow/links.mts', () => ({
  installNpmLinks: mockInstallNpmLinks,
  installNpxLinks: mockInstallNpxLinks,
}))

vi.mock('../../../src/utils/socket/sdk.mts', () => ({
  getPublicApiToken: mockGetPublicApiToken,
}))

vi.mock('../../../src/utils/fs/find-up.mts', () => ({
  findUp: mockFindUp,
}))

vi.mock('../../../src/constants/paths.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    shadowBinPath: '/mock/shadow-bin',
    getShadowNpmInjectPath: vi.fn(() => '/mock/inject.js'),
    getInstrumentWithSentryPath: vi.fn(() => '/mock/sentry.js'),
  }
})

vi.mock('../../../src/constants/shadow.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    SOCKET_IPC_HANDSHAKE: 'SOCKET_IPC_HANDSHAKE',
    SOCKET_CLI_SHADOW_API_TOKEN: 'SOCKET_CLI_SHADOW_API_TOKEN',
    SOCKET_CLI_SHADOW_BIN: 'SOCKET_CLI_SHADOW_BIN',
    SOCKET_CLI_SHADOW_PROGRESS: 'SOCKET_CLI_SHADOW_PROGRESS',
  }
})

vi.mock('../../../src/constants/env.mts', () => ({
  default: {
    INLINED_SOCKET_CLI_SENTRY_BUILD: false,
  },
}))

vi.mock('@socketsecurity/lib/constants/node', () => ({
  getExecPath: vi.fn(() => '/usr/bin/node'),
  getNodeDisableSigusr1Flags: vi.fn(() => ['--no-inspect']),
  getNodeNoWarningsFlags: vi.fn(() => ['--no-warnings']),
  getNodeHardenFlags: vi.fn(() => ['--frozen-intrinsics']),
  supportsNodePermissionFlag: vi.fn(() => true),
}))

describe('shadowNpmBase', () => {
  const mockSpawnResult = Promise.resolve({
    success: true,
    code: 0,
    stdout: '',
    stderr: '',
    process: {
      send: vi.fn(),
      on: vi.fn(),
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockSpawnNode.mockReturnValue(mockSpawnResult)
    mockFindSystemNodejsSync.mockReturnValue('/usr/bin/node')
    mockIsSeaBinary.mockReturnValue(false)
    mockInstallNpmLinks.mockResolvedValue('/usr/bin/npm')
    mockInstallNpxLinks.mockResolvedValue('/usr/bin/npx')
    mockGetPublicApiToken.mockReturnValue('test-token')
    mockFindUp.mockResolvedValue('/mock/node_modules')
  })

  it('should spawn npm with default arguments', async () => {
    const result = await shadowNpmBase(NPM, ['install'])

    expect(mockInstallNpmLinks).toHaveBeenCalledWith('/mock/shadow-bin')

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    expect(nodeArgs).toContain('--no-warnings')
    expect(nodeArgs).toContain('--frozen-intrinsics')
    expect(nodeArgs).toContain('--require')
    expect(nodeArgs).toContain('/mock/inject.js')
    expect(nodeArgs).toContain('/usr/bin/npm')
    expect(nodeArgs).toContain('--no-audit')
    expect(nodeArgs).toContain('--no-fund')
    expect(nodeArgs).toContain('--no-progress')
    expect(nodeArgs).toContain('--loglevel')
    expect(nodeArgs).toContain('error')
    expect(nodeArgs).toContain('install')

    const spawnOptions = spawnCall[1]
    expect(spawnOptions.env).toBeDefined()
    expect(spawnOptions.ipc).toBeDefined()

    expect(result.spawnPromise).toBe(mockSpawnResult)
  })

  it('should spawn npx with correct binary path', async () => {
    await shadowNpmBase(NPX, ['create-react-app'])

    expect(mockInstallNpxLinks).toHaveBeenCalledWith('/mock/shadow-bin')

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    expect(nodeArgs).toContain('/usr/bin/npx')
    expect(nodeArgs).toContain('create-react-app')

    expect(spawnCall[2]).toBeUndefined()
  })

  it('should handle custom cwd option', async () => {
    const options: ShadowBinOptions = {
      cwd: '/custom/path',
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawnNode).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        cwd: '/custom/path',
      }),
      undefined,
    )
  })

  it('should handle URL cwd option', async () => {
    // Use a valid file URL with proper absolute path for all platforms.
    const testPath =
      process.platform === 'win32'
        ? 'file:///C:/custom/path'
        : 'file:///custom/path'
    const options: ShadowBinOptions = {
      cwd: new URL(testPath),
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawnNode).toHaveBeenCalled()
    const spawnCall = mockSpawnNode.mock.calls[0]
    // The cwd should be converted from URL to path string.
    const cwdArg = spawnCall?.[1]?.cwd
    // Normalized paths should use forward slashes.
    expect(cwdArg).toContain('custom')
    expect(cwdArg).toContain('path')
  })

  it('should preserve custom stdio options', async () => {
    const options: ShadowBinOptions = {
      stdio: 'inherit',
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawnNode).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        stdio: 'inherit',
      }),
      undefined,
    )
  })

  it('should add permission flags for npm on supported Node.js versions', async () => {
    await shadowNpmBase(NPM, ['install'])

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    const nodeOptionsArg = nodeArgs.find(arg =>
      arg.startsWith('--node-options='),
    )

    expect(nodeOptionsArg).toBeDefined()
    // Permission flags are combined into a single --node-options string.
    expect(nodeOptionsArg).toContain('--permission')
    expect(nodeOptionsArg).toContain('--allow-child-process')
    expect(nodeOptionsArg).toContain('--allow-fs-read=*')
    // Path separators may be normalized, so check for the directory structure.
    expect(nodeOptionsArg).toMatch(
      /--allow-fs-write=[^'"]*packages[/\\]cli[/\\]\*/,
    )
  })

  it('should not add permission flags for npx', async () => {
    await shadowNpmBase(NPX, ['create-react-app'])

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    const hasPermissionFlags = nodeArgs.some(arg =>
      arg.includes('--permission'),
    )

    expect(hasPermissionFlags).toBe(false)
  })

  it('should preserve existing node-options', async () => {
    await shadowNpmBase(NPM, ['install', '--node-options=--test-option'])

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    const nodeOptionsArg = nodeArgs.find(arg =>
      arg.startsWith('--node-options='),
    )
    expect(nodeOptionsArg).toContain('--test-option')
    expect(nodeOptionsArg).toContain('--permission')
  })

  it('should filter out audit and progress flags', async () => {
    await shadowNpmBase(NPM, [
      'install',
      '--audit',
      '--progress',
      '--no-progress',
    ])

    const spawnCall = mockSpawnNode.mock.calls[0]
    const nodeArgs = spawnCall[0] as string[]
    const hasAuditFlag = nodeArgs.includes('--audit')
    const hasProgressFlag = nodeArgs.includes('--progress')
    const hasNoProgressFlag = nodeArgs.includes('--no-progress')

    expect(hasAuditFlag).toBe(false)
    expect(hasProgressFlag).toBe(false)
    // --no-progress is still added by default.
    expect(hasNoProgressFlag).toBe(true)
  })

  it('should handle terminator args correctly', async () => {
    await shadowNpmBase(NPM, ['install', 'lodash', '--', '--extra', 'args'])

    expect(mockSpawnNode).toHaveBeenCalledWith(
      expect.arrayContaining(['install', 'lodash', '--extra', 'args']),
      expect.any(Object),
      undefined,
    )
  })

  it('should send IPC handshake message', async () => {
    const options: ShadowBinOptions = {
      ipc: { customData: 'test' },
    }

    await shadowNpmBase(NPM, ['install'], options)

    // Verify that spawnNode was called with IPC data.
    const spawnCall = mockSpawnNode.mock.calls[0]
    const spawnOptions = spawnCall[1]
    expect(spawnOptions.ipc).toEqual({
      SOCKET_CLI_SHADOW_API_TOKEN: 'test-token',
      SOCKET_CLI_SHADOW_BIN: 'npm',
      SOCKET_CLI_SHADOW_PROGRESS: true,
      customData: 'test',
    })
  })

  it('should handle progress flag in IPC message', async () => {
    await shadowNpmBase(NPM, ['install', '--no-progress'])

    // Verify that spawnNode was called with IPC data including progress flag.
    const spawnCall = mockSpawnNode.mock.calls[0]
    const spawnOptions = spawnCall[1]
    expect(spawnOptions.ipc).toEqual({
      SOCKET_CLI_SHADOW_API_TOKEN: 'test-token',
      SOCKET_CLI_SHADOW_BIN: 'npm',
      SOCKET_CLI_SHADOW_PROGRESS: false,
    })
  })

  it('should not require system Node.js when not a SEA binary', async () => {
    mockIsSeaBinary.mockReturnValue(false)
    mockFindSystemNodejsSync.mockReturnValue(undefined)

    // Should not throw even though findSystemNodejsSync returns undefined.
    await expect(shadowNpmBase(NPM, ['install'])).resolves.toBeDefined()

    // findSystemNodejsSync should not have been called since we're not a SEA binary.
    expect(mockFindSystemNodejsSync).not.toHaveBeenCalled()
  })

  it('should require system Node.js when running as SEA binary', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockFindSystemNodejsSync.mockReturnValue('/usr/bin/node')

    // Should succeed when system Node.js is found.
    await expect(shadowNpmBase(NPM, ['install'])).resolves.toBeDefined()

    expect(mockFindSystemNodejsSync).toHaveBeenCalled()
  })

  it('should throw error when SEA binary and no system Node.js found', async () => {
    mockIsSeaBinary.mockReturnValue(true)
    mockFindSystemNodejsSync.mockReturnValue(undefined)

    // Should throw when running as SEA and no system Node.js is found.
    await expect(shadowNpmBase(NPM, ['install'])).rejects.toThrow(
      'System Node.js not found. npm/npx require Node.js to be installed.',
    )

    expect(mockFindSystemNodejsSync).toHaveBeenCalled()
  })
})
