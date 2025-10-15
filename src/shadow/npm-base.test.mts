import { promises as fs } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import shadowNpmBase from './npm-base.mts'
import { NPM, NPX } from '../constants.mts'

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

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('../utils/shadow/links.mts', () => ({
  installNpmLinks: mockInstallNpmLinks,
  installNpxLinks: mockInstallNpxLinks,
}))

vi.mock('../utils/socket/sdk.mjs', () => ({
  getPublicApiToken: mockGetPublicApiToken,
}))

vi.mock('../utils/fs.mts', () => ({
  findUp: mockFindUp,
}))

vi.mock('./stdio-ipc.mts', () => ({
  ensureIpcInStdio: mockEnsureIpcInStdio,
}))

vi.mock('../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      execPath: '/usr/bin/node',
      shadowBinPath: '/mock/shadow-bin',
      shadowNpmInjectPath: '/mock/inject.js',
      instrumentWithSentryPath: '/mock/sentry.js',
      nodeNoWarningsFlags: ['--no-warnings'],
      nodeDebugFlags: ['--inspect=0'],
      nodeHardenFlags: ['--frozen-intrinsics'],
      nodeMemoryFlags: [],
      processEnv: { CUSTOM_ENV: 'test' },
      SUPPORTS_NODE_PERMISSION_FLAG: true,
      npmGlobalPrefix: '/usr/local',
      npmCachePath: '/home/.npm',
      ENV: {
        INLINED_SOCKET_CLI_SENTRY_BUILD: false,
      },
      SOCKET_IPC_HANDSHAKE: 'SOCKET_IPC_HANDSHAKE',
      SOCKET_CLI_SHADOW_API_TOKEN: 'SOCKET_CLI_SHADOW_API_TOKEN',
      SOCKET_CLI_SHADOW_BIN: 'SOCKET_CLI_SHADOW_BIN',
      SOCKET_CLI_SHADOW_PROGRESS: 'SOCKET_CLI_SHADOW_PROGRESS',
    },
  }
})

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
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      expect.arrayContaining([
        '--no-warnings',
        '--inspect=0',
        '--frozen-intrinsics',
        '--require',
        '/mock/inject.js',
        '/usr/bin/npm',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--loglevel',
        'error',
        'install',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          CUSTOM_ENV: 'test',
        }),
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }),
      undefined,
    )
    expect(result.spawnPromise).toBe(mockSpawnResult)
  })

  it('should spawn npx with correct binary path', async () => {
    await shadowNpmBase(NPX, ['create-react-app'])

    expect(mockInstallNpxLinks).toHaveBeenCalledWith('/mock/shadow-bin')
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      expect.arrayContaining(['/usr/bin/npx', 'create-react-app']),
      expect.any(Object),
      undefined,
    )
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
    const options: ShadowBinOptions = {
      cwd: new URL('file:///custom/path'),
    }

    await shadowNpmBase(NPM, ['install'], options)

    expect(mockSpawn).toHaveBeenCalled()
    const spawnCall = mockSpawn.mock.calls[0]
    // The cwd should be converted from URL to path string.
    const cwdArg = spawnCall?.[2]?.cwd
    // Handle both URL object and string path.
    const actualCwd = cwdArg instanceof URL ? cwdArg.pathname : cwdArg
    expect(actualCwd).toBe('/custom/path')
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

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        `--node-options='--permission --allow-child-process --allow-fs-read=* --allow-fs-write=${process.cwd()}/* --allow-fs-write=/usr/local/* --allow-fs-write=/home/.npm/*'`,
      ]),
      expect.any(Object),
      undefined,
    )
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
