import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

// Mock shadowPnpmBin.
const mockShadowPnpmBin = vi.fn()

vi.mock('./shadow/pnpm/bin.mts', () => ({
  default: mockShadowPnpmBin,
}))

describe('pnpm-cli', () => {
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
    mockShadowPnpmBin.mockResolvedValue(mockSpawnResult)
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })

    // Clear module cache to ensure fresh imports.
    vi.resetModules()
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs', 'install']

    try {
      await import('./pnpm-cli.mts')
      expect(process.exitCode).toBe(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowPnpmBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs', 'add', 'lodash']

    try {
      await import('./pnpm-cli.mts')

      expect(mockShadowPnpmBin).toHaveBeenCalledWith(['add', 'lodash'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: { ...process.env },
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with numeric code', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs', 'test']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(2, null)
      }
    })

    try {
      await import('./pnpm-cli.mts')

      expect(mockProcessExit).toHaveBeenCalledWith(2)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs', 'dev']

    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Trigger callback immediately.
        callback(null, 'SIGKILL')
      }
    })

    try {
      await import('./pnpm-cli.mts')

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGKILL')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs']

    try {
      await import('./pnpm-cli.mts')

      expect(mockShadowPnpmBin).toHaveBeenCalledWith([], {
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
    process.argv = ['node', 'pnpm-cli.mjs', 'run', 'lint']
    process.env = { ...originalEnv, PNPM_HOME: '/custom/path' }

    try {
      await import('./pnpm-cli.mts')

      expect(mockShadowPnpmBin).toHaveBeenCalledWith(['run', 'lint'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: expect.objectContaining({ PNPM_HOME: '/custom/path' }),
      })
    } finally {
      process.argv = originalArgv
      process.env = originalEnv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mjs', 'list']

    const mockThen = vi.fn().mockResolvedValue({ success: true })
    mockShadowPnpmBin.mockResolvedValue({
      spawnPromise: {
        process: mockChildProcess,
        then: mockThen,
      },
    })

    try {
      await import('./pnpm-cli.mts')

      // The spawn promise should be awaited.
      expect(mockThen).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
