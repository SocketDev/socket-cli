import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NPM, NPX } from '@socketsecurity/lib/constants/agents'

import shadowNpmBase from './npm-base.mts'

import type { ShadowBinOptions } from './npm-base.mts'

// Mock all dependencies.
const mockSpawn = vi.hoisted(() => vi.fn())
const mockInstallNpmLinks = vi.hoisted(() => vi.fn())
const mockInstallNpxLinks = vi.hoisted(() => vi.fn())
const mockGetPublicApiToken = vi.hoisted(() => vi.fn())
const mockFindUp = vi.hoisted(() => vi.fn())
const mockEnsureIpcInStdio = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
    },
  }
})

vi.mock('@socketsecurity/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../utils/shadow/links.mts', () => ({
  installNpmLinks: mockInstallNpmLinks,
  installNpxLinks: mockInstallNpxLinks,
}))

vi.mock('../utils/socket/sdk.mts', () => ({
  getPublicApiToken: mockGetPublicApiToken,
}))

vi.mock('../utils/fs/find-up.mts', () => ({
  findUp: mockFindUp,
}))

vi.mock('./stdio-ipc.mts', () => ({
  ensureIpcInStdio: mockEnsureIpcInStdio,
}))

vi.mock('../constants/paths.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    shadowBinPath: '/mock/shadow-bin',
    getShadowNpmInjectPath: vi.fn(() => '/mock/inject.js'),
    getInstrumentWithSentryPath: vi.fn(() => '/mock/sentry.js'),
  }
})

vi.mock('../constants/shadow.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    SOCKET_IPC_HANDSHAKE: 'SOCKET_IPC_HANDSHAKE',
    SOCKET_CLI_SHADOW_API_TOKEN: 'SOCKET_CLI_SHADOW_API_TOKEN',
    SOCKET_CLI_SHADOW_BIN: 'SOCKET_CLI_SHADOW_BIN',
    SOCKET_CLI_SHADOW_PROGRESS: 'SOCKET_CLI_SHADOW_PROGRESS',
  }
})

vi.mock('../constants/env.mts', () => ({
  default: {
    INLINED_SOCKET_CLI_SENTRY_BUILD: false,
  },
}))

vi.mock('@socketsecurity/lib/constants/node', () => ({
  getExecPath: vi.fn(() => '/usr/bin/node'),
  getNodeDisableSigusr1Flags: vi.fn(() => ['--no-inspect']),
  getNodeNoWarningsFlags: vi.fn(() => ['--no-warnings']),
  getNodeDebugFlags: vi.fn(() => ['--inspect=0']),
  getNodeHardenFlags: vi.fn(() => ['--frozen-intrinsics']),
  supportsNodePermissionFlag: vi.fn(() => true),
}))

describe('shadowNpmBase', () => {
  const mockProcess = {
    send: vi.fn(),
    on: vi.fn(),
  }

  const mockSpawnResult = {
    process: mockProcess,
    then: vi.fn().mockImplementation(cb =>
      cb({
        success: true,
        code: 0,
        stdout: '',
        stderr: '',
      }),
    ),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations.
    mockSpawn.mockReturnValue(mockSpawnResult)
    mockInstallNpmLinks.mockResolvedValue('/usr/bin/npm')
    mockInstallNpxLinks.mockResolvedValue('/usr/bin/npx')
    mockGetPublicApiToken.mockReturnValue('test-token')
    mockFindUp.mockResolvedValue('/mock/node_modules')
    mockEnsureIpcInStdio.mockReturnValue(['pipe', 'pipe', 'pipe', 'ipc'])
  })

  it('should spawn npm with default arguments', async () => {
    const result = await shadowNpmBase(NPM, ['install'])

    expect(mockInstallNpmLinks).toHaveBeenCalledWith('/mock/shadow-bin')

    const spawnCall = mockSpawn.mock.calls[0]
    expect(spawnCall[0]).toBe('/usr/bin/node')

    const nodeArgs = spawnCall[1] as string[]
    expect(nodeArgs).toContain('--no-warnings')
    expect(nodeArgs).toContain('--inspect=0')
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

    const spawnOptions = spawnCall[2]
    expect(spawnOptions.stdio).toEqual(['pipe', 'pipe', 'pipe', 'ipc'])
    expect(spawnOptions.env).toBeDefined()

    expect(result.spawnPromise).toBe(mockSpawnResult)
  })

  it('should spawn npx with correct binary path', async () => {
    await shadowNpmBase(NPX, ['create-react-app'])

    expect(mockInstallNpxLinks).toHaveBeenCalledWith('/mock/shadow-bin')

    const spawnCall = mockSpawn.mock.calls[0]
    expect(spawnCall[0]).toBe('/usr/bin/node')

    const nodeArgs = spawnCall[1] as string[]
    expect(nodeArgs).toContain('/usr/bin/npx')
    expect(nodeArgs).toContain('create-react-app')

    expect(spawnCall[3]).toBeUndefined()
  })

  it('should handle custom cwd option', async () => {
    const options: ShadowBinOptions = {
      cwd: '/custom/path',
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: '/custom/path',
      }),
      undefined,
    )
  })

  it('should handle URL cwd option', async () => {
    // Use a valid file URL with proper absolute path for all platforms.
    const testPath = process.platform === 'win32'
      ? 'file:///C:/custom/path'
      : 'file:///custom/path'
    const options: ShadowBinOptions = {
      cwd: new URL(testPath),
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawn).toHaveBeenCalled()
    const spawnCall = mockSpawn.mock.calls[0]
    // The cwd should be converted from URL to path string.
    const cwdArg = spawnCall?.[2]?.cwd
    // Normalized paths should use forward slashes.
    expect(cwdArg).toContain('custom')
    expect(cwdArg).toContain('path')
  })

  it('should preserve custom stdio options', async () => {
    const options: ShadowBinOptions = {
      stdio: 'inherit',
    }
    mockEnsureIpcInStdio.mockReturnValue([
      'inherit',
      'inherit',
      'inherit',
      'ipc',
    ])

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockEnsureIpcInStdio).toHaveBeenCalledWith('inherit')
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      }),
      undefined,
    )
  })

  it('should add permission flags for npm on supported Node.js versions', async () => {
    await shadowNpmBase(NPM, ['install'])

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]
    const nodeOptionsArg = nodeArgs.find(arg =>
      arg.startsWith('--node-options='),
    )

    expect(nodeOptionsArg).toBeDefined()
    // Permission flags are combined into a single --node-options string.
    expect(nodeOptionsArg).toContain('--permission')
    expect(nodeOptionsArg).toContain('--allow-child-process')
    expect(nodeOptionsArg).toContain('--allow-fs-read=*')
    // Path separators may be normalized, so check for the directory structure.
    expect(nodeOptionsArg).toMatch(/--allow-fs-write=[^'"]*packages[/\\]cli[/\\]\*/)
  })

  it('should not add permission flags for npx', async () => {
    await shadowNpmBase(NPX, ['create-react-app'])

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]
    const hasPermissionFlags = nodeArgs.some(arg =>
      arg.includes('--permission'),
    )

    expect(hasPermissionFlags).toBe(false)
  })

  it('should preserve existing node-options', async () => {
    await shadowNpmBase(NPM, ['install', '--node-options=--test-option'])

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]
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

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]
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

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
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

    expect(mockProcess.send).toHaveBeenCalledWith({
      SOCKET_IPC_HANDSHAKE: {
        SOCKET_CLI_SHADOW_API_TOKEN: 'test-token',
        SOCKET_CLI_SHADOW_BIN: 'npm',
        SOCKET_CLI_SHADOW_PROGRESS: true,
        customData: 'test',
      },
    })
  })

  it('should handle progress flag in IPC message', async () => {
    await shadowNpmBase(NPM, ['install', '--no-progress'])

    expect(mockProcess.send).toHaveBeenCalledWith({
      SOCKET_IPC_HANDSHAKE: {
        SOCKET_CLI_SHADOW_API_TOKEN: 'test-token',
        SOCKET_CLI_SHADOW_BIN: 'npm',
        SOCKET_CLI_SHADOW_PROGRESS: false,
      },
    })
  })
})
