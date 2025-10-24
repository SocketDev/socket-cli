import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock shadow/npm/bin module.
vi.mock('./shadow/npm/bin.mts', () => ({
  default: vi.fn(),
}))

// Import modules after mocks are set up.
const { default: runNpmCli } = await import('./npm-cli.mts')
const shadowNpmBinModule = await import('./shadow/npm/bin.mts')
const mockShadowNpmBin = vi.mocked(shadowNpmBinModule.default)

// Mock process methods.
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never)
const mockProcessKill = vi.spyOn(process, 'kill').mockImplementation(() => true)

describe('npm-cli', () => {
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
    mockShadowNpmBin.mockResolvedValue(createMockSpawnResult(0))
    mockChildProcess.on.mockImplementation(() => {
      // No-op by default.
    })
  })

  it('should set initial exit code to 1', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'install']

    try {
      const promise = runNpmCli()
      expect(process.exitCode).toBe(1)
      await promise
    } finally {
      process.argv = originalArgv
    }
  })

  it('should call shadowNpmBin with correct arguments', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'install', 'lodash']

    try {
      await runNpmCli()

      expect(mockShadowNpmBin).toHaveBeenCalledWith(['install', 'lodash'], {
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
    process.argv = ['node', 'npm-cli.mjs', 'install']

    // Mock spawn result with exit code 1.
    mockShadowNpmBin.mockResolvedValue(createMockSpawnResult(1))

    try {
      await runNpmCli()

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle process exit with signal', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'test']

    // Mock spawn result with signal.
    mockShadowNpmBin.mockResolvedValue({
      spawnPromise: Promise.resolve({
        success: false,
        code: null,
        signal: 'SIGTERM',
      }).then(result => Object.assign(result, { process: mockChildProcess })),
    })

    try {
      await runNpmCli()

      expect(mockProcessKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally {
      process.argv = originalArgv
    }
  })

  it('should handle empty arguments array', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs']

    try {
      await runNpmCli()

      expect(mockShadowNpmBin).toHaveBeenCalledWith([], {
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
    process.argv = ['node', 'npm-cli.mjs', 'run', 'build']
    process.env = { ...originalEnv, CUSTOM_VAR: 'test-value' }

    try {
      await runNpmCli()

      expect(mockShadowNpmBin).toHaveBeenCalledWith(['run', 'build'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        env: expect.objectContaining({ CUSTOM_VAR: 'test-value' }),
      })
    } finally {
      process.argv = originalArgv
      process.env = originalEnv
    }
  })

  it('should wait for spawn promise completion', async () => {
    const originalArgv = process.argv
    process.argv = ['node', 'npm-cli.mjs', 'version']

    try {
      await runNpmCli()

      // The spawn promise should be awaited.
      expect(mockShadowNpmBin).toHaveBeenCalled()
    } finally {
      process.argv = originalArgv
    }
  })
})
