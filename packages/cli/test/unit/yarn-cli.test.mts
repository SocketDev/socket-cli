import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawnSfw from dlx/spawn.
vi.mock('../../src/utils/dlx/spawn.mts', () => ({
  spawnSfw: vi.fn(),
}))

// Import modules after mocks are set up.
const { default: runYarnCli } = await import('../../src/yarn-cli.mts')
const spawnModule = await import('../../src/utils/dlx/spawn.mts')
const mockSpawnSfw = vi.mocked(spawnModule.spawnSfw)

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

describe('yarn-cli', () => {
  const mockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  // Create a proper promise-like object for spawnPromise.
  const createMockSpawnResult = (exitCode = 0) => ({
    spawnPromise: Promise.resolve({
      success: exitCode === 0,
      code: exitCode,
      signal: undefined,
    }).then(result => Object.assign(result, { process: mockChildProcess })),
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset process properties.
    process.exitCode = undefined

    // Setup default mock implementations.
    mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mts', 'install']

    try {
      const promise = runYarnCli()
      expect(process.exitCode).toBe(1)
      await promise
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call spawnSfw with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mts', 'add', 'react', 'react-dom']

    try {
      await runYarnCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(
        ['yarn', 'add', 'react', 'react-dom'],
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
    process.argv = ['node', 'yarn-cli.mts', 'build']

    // Mock spawn result with exit code 1.
    mockSpawnSfw.mockResolvedValue(createMockSpawnResult(1))

    try {
      await runYarnCli()

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mts', 'start']

    // Mock spawn result with signal.
    mockSpawnSfw.mockResolvedValue({
      spawnPromise: Promise.resolve({
        success: false,
        code: null,
        signal: 'SIGTERM',
      }).then(result => Object.assign(result, { process: mockChildProcess })),
    })

    try {
      await runYarnCli()

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mts']

    try {
      await runYarnCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(['yarn'], {
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
    process.argv = ['node', 'yarn-cli.mts', 'workspace', 'list']
    process.env = { ...originalEnv, YARN_CACHE_FOLDER: '/tmp/yarn-cache' }

    try {
      await runYarnCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(['yarn', 'workspace', 'list'], {
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
    process.argv = ['node', 'yarn-cli.mts', 'info', 'lodash']

    try {
      await runYarnCli()

      // The spawn promise should be awaited.
      expect(mockSpawnSfw).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
