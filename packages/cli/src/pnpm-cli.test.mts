import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock spawnSfw from dlx/spawn.
vi.mock('./utils/dlx/spawn.mts', () => ({
  spawnSfw: vi.fn(),
}))

// Import modules after mocks are set up.
const { default: runPnpmCli } = await import('./pnpm-cli.mts')
const spawnModule = await import('./utils/dlx/spawn.mts')
const mockSpawnSfw = vi.mocked(spawnModule.spawnSfw)

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

describe('pnpm-cli', () => {
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
    process.argv = ['node', 'pnpm-cli.mts', 'install']

    try {
      const promise = runPnpmCli()
      expect(process.exitCode).toBe(1)
      await promise
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call spawnSfw with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mts', 'add', 'lodash']

    try {
      await runPnpmCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(['pnpm', 'add', 'lodash'], {
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
    process.argv = ['node', 'pnpm-cli.mts', 'test']

    // Mock spawn result with exit code 2.
    mockSpawnSfw.mockResolvedValue(createMockSpawnResult(2))

    try {
      await runPnpmCli()

      expect(mockProcessExit).toHaveBeenCalledWith(2)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mts', 'dev']

    // Mock spawn result with signal.
    mockSpawnSfw.mockResolvedValue({
      spawnPromise: Promise.resolve({
        success: false,
        code: null,
        signal: 'SIGKILL',
      }).then(result => Object.assign(result, { process: mockChildProcess })),
    })

    try {
      await runPnpmCli()

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGKILL')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'pnpm-cli.mts']

    try {
      await runPnpmCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(['pnpm'], {
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
    process.argv = ['node', 'pnpm-cli.mts', 'run', 'lint']
    process.env = { ...originalEnv, PNPM_HOME: '/custom/path' }

    try {
      await runPnpmCli()

      expect(mockSpawnSfw).toHaveBeenCalledWith(['pnpm', 'run', 'lint'], {
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
    process.argv = ['node', 'pnpm-cli.mts', 'list']

    try {
      await runPnpmCli()

      // The spawn promise should be awaited.
      expect(mockSpawnSfw).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
