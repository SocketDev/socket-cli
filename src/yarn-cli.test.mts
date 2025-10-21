import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

// Mock shadowYarnBin.
const mockShadowYarnBin = vi.fn()

vi.mock('./shadow/yarn/bin.mts', () => ({
  default: mockShadowYarnBin,
}))

describe('yarn-cli', () => {
  const mockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  const mockSpawnResult = {
    spawnPromise: {
      process: mockChildProcess,
      then: vi.fn().mockResolvedValue({ success: true, code: 0 }),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset process properties.
    process.exitCode = undefined

    // Setup default mock implementations.
    mockShadowYarnBin.mockResolvedValue(mockSpawnResult)
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })

    // Clear module cache to ensure fresh imports.
    vi.resetModules()
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'install']

    try {
      await import('./yarn-cli.mts')
      expect(process.exitCode).toBe(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowYarnBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'add', 'react', 'react-dom']

    try {
      await import('./yarn-cli.mts')

      expect(mockShadowYarnBin).toHaveBeenCalledWith(
        ['add', 'react', 'react-dom'],
        {
          stdio: 'inherit',
          cwd: process.cwd(),
          env: { ...process.env },
        },
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with numeric code', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'build']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(1, null)
      }
    })

    try {
      await import('./yarn-cli.mts')

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'start']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(null, 'SIGTERM')
      }
    })

    try {
      await import('./yarn-cli.mts')

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs']

    try {
      await import('./yarn-cli.mts')

      expect(mockShadowYarnBin).toHaveBeenCalledWith([], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should preserve environment variables in spawn options', async () => {
    const originalArgv = process.argv
    const originalEnv = process.env
    process.argv = ['node', 'yarn-cli.mjs', 'workspace', 'list']
    process.env = { ...originalEnv, YARN_CACHE_FOLDER: '/tmp/yarn-cache' }

    try {
      await import('./yarn-cli.mts')

      expect(mockShadowYarnBin).toHaveBeenCalledWith(['workspace', 'list'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: expect.objectContaining({ YARN_CACHE_FOLDER: '/tmp/yarn-cache' }),
      })
    } finally {
      process.argv = originalArgv
      process.env = originalEnv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mjs', 'info', 'lodash']

    const mockThen = vi.fn().mockResolvedValue({ success: true })
    mockShadowYarnBin.mockResolvedValue({
      spawnPromise: {
        process: mockChildProcess,
        then: mockThen,
      },
    })

    try {
      await import('./yarn-cli.mts')

      // The spawn promise should be awaited.
      expect(mockThen).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
