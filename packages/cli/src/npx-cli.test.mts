import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock shadow/npx/bin module.
vi.mock('./shadow/npx/bin.mts', () => ({
  default: vi.fn(),
}))

// Import modules after mocks are set up.
const { default: runNpxCli } = await import('./npx-cli.mts')
const shadowNpxBinModule = await import('./shadow/npx/bin.mts')
const mockShadowNpxBin = vi.mocked(shadowNpxBinModule.default)

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

describe('npx-cli', () => {
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
    mockShadowNpxBin.mockResolvedValue(createMockSpawnResult(0))
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'create-react-app', 'my-app']

    try {
      const promise = runNpxCli()
      expect(process.exitCode).toBe(1)
      await promise
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowNpxBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'create-next-app@latest', 'my-app']

    try {
      await runNpxCli()

      expect(mockShadowNpxBin).toHaveBeenCalledWith(
        ['create-next-app@latest', 'my-app'],
        {
          stdio: 'inherit',
        },
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with numeric code', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'eslint', '.']

    // Mock spawn result with exit code 1.
    mockShadowNpxBin.mockResolvedValue(createMockSpawnResult(1))

    try {
      await runNpxCli()

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'webpack-dev-server']

    // Mock spawn result with signal.
    mockShadowNpxBin.mockResolvedValue({
      spawnPromise: Promise.resolve({
        success: false,
        code: null,
        signal: 'SIGINT',
      }).then(result => Object.assign(result, { process: mockChildProcess })),
    })

    try {
      await runNpxCli()

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts']

    try {
      await runNpxCli()

      expect(mockShadowNpxBin).toHaveBeenCalledWith([], {
        stdio: 'inherit',
      })
    } finally {
      process.argv = originalArgv
    }
  })

  it('should use stdio inherit for process communication', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'typescript', '--version']

    try {
      await runNpxCli()

      expect(mockShadowNpxBin).toHaveBeenCalledWith(
        ['typescript', '--version'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    } finally {
      process.argv = originalArgv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npx-cli.mts', 'jest', '--version']

    try {
      await runNpxCli()

      // The spawn promise should be awaited.
      expect(mockShadowNpxBin).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
