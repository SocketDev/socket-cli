import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock shadow/yarn/bin module.
vi.mock('./shadow/yarn/bin.mts', () => ({
  default: vi.fn(),
}))

// Import modules after mocks are set up.
const { default: runYarnCli } = await import('./yarn-cli.mts')
const shadowYarnBinModule = await import('./shadow/yarn/bin.mts')
const mockShadowYarnBin = vi.mocked(shadowYarnBinModule.default)

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
  const createMockSpawnResult = (exitCode = 0, signal?: string) => {
    const promise = Promise.resolve({
      success: exitCode === 0,
      code: signal ? null : exitCode,
      signal,
    })
    // Attach the process property to the promise itself.
    Object.assign(promise, { process: mockChildProcess })
    return {
      spawnPromise: promise,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset process properties.
    process.exitCode = undefined

    // Setup default mock implementations.
    mockShadowYarnBin.mockResolvedValue(createMockSpawnResult(0))

    // Mock the .on() method to immediately trigger the event handler.
    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        // Store the callback to be called later when needed.
        // In default case (success), trigger with code 0.
        Promise.resolve().then(() => callback(0, null))
      }
      return mockChildProcess as any
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

  it('should call shadowYarnBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'yarn-cli.mts', 'add', 'react', 'react-dom']

    try {
      await runYarnCli()

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
    process.argv = ['node', 'yarn-cli.mts', 'build']

    // Mock spawn result with exit code 1.
    mockShadowYarnBin.mockResolvedValue(createMockSpawnResult(1))

    // Override the .on() mock to trigger exit with code 1.
    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        Promise.resolve().then(() => callback(1, null))
      }
      return mockChildProcess as any
    })

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
    const promise = Promise.resolve({
      success: false,
      code: null,
      signal: 'SIGTERM',
    })
    // Attach the process property to the promise itself.
    Object.assign(promise, { process: mockChildProcess })
    mockShadowYarnBin.mockResolvedValue({
      spawnPromise: promise,
    })

    // Override the .on() mock to trigger exit with signal.
    mockChildProcess.on.mockImplementation((event, callback) => {
      if (event === 'exit') {
        Promise.resolve().then(() => callback(null, 'SIGTERM'))
      }
      return mockChildProcess as any
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
    process.argv = ['node', 'yarn-cli.mts', 'workspace', 'list']
    process.env = { ...originalEnv, YARN_CACHE_FOLDER: '/tmp/yarn-cache' }

    try {
      await runYarnCli()

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
    process.argv = ['node', 'yarn-cli.mts', 'info', 'lodash']

    try {
      await runYarnCli()

      // The spawn promise should be awaited.
      expect(mockShadowYarnBin).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
