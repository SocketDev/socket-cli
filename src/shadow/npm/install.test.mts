import { beforeEach, describe, expect, it, vi } from 'vitest'

import { shadowNpmInstall } from './install.mts'

import type { ShadowNpmInstallOptions } from './install.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

// Mock all dependencies.
const mockSpawn = vi.hoisted(() => vi.fn())
const mockGetNpmBinPath = vi.hoisted(() => vi.fn())
const mockResolveBinPathSync = vi.hoisted(() => vi.fn())

vi.mock('@socketsecurity/registry/lib/spawn', () => ({
  spawn: mockSpawn,
}))

vi.mock('@socketsecurity/registry/lib/agent', () => ({
  isNpmAuditFlag: vi.fn(
    (arg: string) => arg === '--audit' || arg === '--no-audit',
  ),
  isNpmFundFlag: vi.fn(
    (arg: string) => arg === '--fund' || arg === '--no-fund',
  ),
  isNpmLoglevelFlag: vi.fn((arg: string) => arg.startsWith('--loglevel')),
  isNpmProgressFlag: vi.fn(
    (arg: string) => arg === '--progress' || arg === '--no-progress',
  ),
  resolveBinPathSync: mockResolveBinPathSync,
}))

vi.mock('../../utils/npm-paths.mts', () => ({
  getNpmBinPath: mockGetNpmBinPath,
}))

vi.mock('../../constants.mts', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, any>
  return {
    ...actual,
    default: {
      ...actual?.default,
      execPath: '/usr/bin/node',
      shadowNpmInjectPath: '/mock/inject.js',
      instrumentWithSentryPath: '/mock/sentry.js',
      nodeNoWarningsFlags: ['--no-warnings'],
      nodeDebugFlags: ['--inspect=0'],
      nodeHardenFlags: ['--frozen-intrinsics'],
      nodeMemoryFlags: [],
      processEnv: { SOCKET_ENV: 'test' },
      ENV: {
        INLINED_SOCKET_CLI_SENTRY_BUILD: false,
      },
      SOCKET_IPC_HANDSHAKE: 'SOCKET_IPC_HANDSHAKE',
      SOCKET_CLI_SHADOW_BIN: 'SOCKET_CLI_SHADOW_BIN',
      SOCKET_CLI_SHADOW_PROGRESS: 'SOCKET_CLI_SHADOW_PROGRESS',
    },
    NPM: 'npm',
    FLAG_LOGLEVEL: '--loglevel',
  }
})

describe('shadowNpmInstall', () => {
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

  let mockSpinner: Spinner

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock spinner.
    mockSpinner = {
      stop: vi.fn(),
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    } as any

    // Default mock implementations.
    mockSpawn.mockReturnValue(mockSpawnResult)
    mockGetNpmBinPath.mockReturnValue('/usr/bin/npm')
    mockResolveBinPathSync.mockImplementation((path: string) => path)
  })

  it('should spawn npm install with default arguments', () => {
    const result = shadowNpmInstall()

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/node',
      expect.arrayContaining([
        '--no-warnings',
        '--inspect=0',
        '--frozen-intrinsics',
        '--require',
        '/mock/inject.js',
        '/usr/bin/npm',
        'install',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--loglevel',
        'silent',
      ]),
      expect.objectContaining({
        env: expect.objectContaining({
          SOCKET_ENV: 'test',
        }),
        stdio: 'pipe',
      }),
    )
    expect(result).toBe(mockSpawnResult)
  })

  it('should use custom agent exec path', () => {
    const options: ShadowNpmInstallOptions = {
      agentExecPath: '/custom/npm',
    }

    shadowNpmInstall(options)

    expect(mockResolveBinPathSync).toHaveBeenCalledWith('/custom/npm')
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['/custom/npm']),
      expect.any(Object),
    )
  })

  it('should handle custom arguments', () => {
    const options: ShadowNpmInstallOptions = {
      args: ['--save-dev', 'typescript'],
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['install', '--save-dev', 'typescript']),
      expect.any(Object),
    )
  })

  it('should filter out audit, fund, and progress flags', () => {
    const options: ShadowNpmInstallOptions = {
      args: ['--audit', '--fund', '--progress', '--save'],
    }

    shadowNpmInstall(options)

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]

    expect(nodeArgs).not.toContain('--audit')
    expect(nodeArgs).not.toContain('--fund')
    expect(nodeArgs).not.toContain('--progress')
    expect(nodeArgs).toContain('--save')
  })

  it('should handle terminator args correctly', () => {
    const options: ShadowNpmInstallOptions = {
      args: ['--save', '--', '--extra', 'args'],
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['install', '--save', '--extra', 'args']),
      expect.any(Object),
    )
  })

  it('should not add silent loglevel when loglevel flag is present', () => {
    const options: ShadowNpmInstallOptions = {
      args: ['--loglevel', 'warn'],
    }

    shadowNpmInstall(options)

    const spawnCall = mockSpawn.mock.calls[0]
    const nodeArgs = spawnCall[1] as string[]
    const loglevelIndex = nodeArgs.indexOf('--loglevel')

    expect(loglevelIndex).toBeGreaterThan(-1)
    expect(nodeArgs[loglevelIndex + 1]).toBe('warn')
    expect(nodeArgs).not.toContain('silent')
  })

  it('should handle string stdio option with IPC', () => {
    const options: ShadowNpmInstallOptions = {
      stdio: 'inherit',
      ipc: { test: 'data' },
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      }),
    )
  })

  it('should handle array stdio option with IPC', () => {
    const options: ShadowNpmInstallOptions = {
      stdio: ['pipe', 'inherit', 'pipe'],
      ipc: { test: 'data' },
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio: ['pipe', 'inherit', 'pipe', 'ipc'],
      }),
    )
  })

  it('should not modify stdio when IPC already present in array', () => {
    const stdio = ['pipe', 'pipe', 'pipe', 'ipc']
    const options: ShadowNpmInstallOptions = {
      stdio,
      ipc: { test: 'data' },
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio,
      }),
    )
  })

  it('should handle undefined stdio with IPC', () => {
    const options: ShadowNpmInstallOptions = {
      ipc: { test: 'data' },
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }),
    )
  })

  it('should send IPC handshake when ipc option is provided', () => {
    const options: ShadowNpmInstallOptions = {
      ipc: { customData: 'test' },
    }

    shadowNpmInstall(options)

    expect(mockProcess.send).toHaveBeenCalledWith({
      SOCKET_IPC_HANDSHAKE: {
        SOCKET_CLI_SHADOW_BIN: 'npm',
        SOCKET_CLI_SHADOW_PROGRESS: true,
        customData: 'test',
      },
    })
  })

  it('should not send IPC message when ipc option is not provided', () => {
    shadowNpmInstall()

    expect(mockProcess.send).not.toHaveBeenCalled()
  })

  it('should handle progress flag in IPC message', () => {
    const options: ShadowNpmInstallOptions = {
      args: ['--no-progress'],
      ipc: { test: 'data' },
    }

    shadowNpmInstall(options)

    expect(mockProcess.send).toHaveBeenCalledWith({
      SOCKET_IPC_HANDSHAKE: {
        SOCKET_CLI_SHADOW_BIN: 'npm',
        SOCKET_CLI_SHADOW_PROGRESS: false,
        test: 'data',
      },
    })
  })

  it('should pass spinner option to spawn', () => {
    const options: ShadowNpmInstallOptions = {
      spinner: mockSpinner,
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        spinner: mockSpinner,
      }),
    )
  })

  it('should merge custom environment variables', () => {
    const options: ShadowNpmInstallOptions = {
      env: { CUSTOM_VAR: 'value' },
    }

    shadowNpmInstall(options)

    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          SOCKET_ENV: 'test',
          CUSTOM_VAR: 'value',
        }),
      }),
    )
  })
})
