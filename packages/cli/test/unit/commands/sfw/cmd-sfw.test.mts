import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock spawnSfw.
const mockSpawnSfw = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dlx/spawn.mts', () => ({
  spawnSfw: mockSpawnSfw,
}))

// Import after mocks.
const { cmdSfw } = await import('../../../../src/commands/sfw/cmd-sfw.mts')

describe('cmd-sfw', () => {
  const mockChildProcess = {
    on: vi.fn(),
    pid: 12345,
  }

  const createMockSpawnResult = (exitCode = 0, signal?: string) => ({
    spawnPromise: Promise.resolve({
      code: signal ? undefined : exitCode,
      signal,
      success: exitCode === 0 && !signal,
    }).then(result => Object.assign(result, { process: mockChildProcess })),
  })

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description with alias', () => {
      expect(cmdSfw.description).toBe(
        'Run Socket Firewall directly (alias: firewall)',
      )
    })

    it('should not be hidden', () => {
      expect(cmdSfw.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-sfw.mts' }
    const context = { parentName: 'socket' }

    it('should pass arguments to spawnSfw', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      await cmdSfw.run(['npm', 'install', 'lodash'], importMeta, context)

      expect(mockSpawnSfw).toHaveBeenCalledWith(['npm', 'install', 'lodash'], {
        stdio: 'inherit',
      })
    })

    it('should handle pip install command', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      await cmdSfw.run(['pip', 'install', 'requests'], importMeta, context)

      expect(mockSpawnSfw).toHaveBeenCalledWith(
        ['pip', 'install', 'requests'],
        { stdio: 'inherit' },
      )
    })

    it('should handle npx command', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      await cmdSfw.run(['npx', 'cowsay', 'hello'], importMeta, context)

      expect(mockSpawnSfw).toHaveBeenCalledWith(['npx', 'cowsay', 'hello'], {
        stdio: 'inherit',
      })
    })

    it('should set exitCode on non-zero exit', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(1))

      await cmdSfw.run(
        ['npm', 'install', 'nonexistent-pkg'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(1)
    })

    it('should log info message when invoking sfw', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      await cmdSfw.run(['cargo', 'build'], importMeta, context)

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Invoking Socket Firewall: sfw cargo build',
      )
    })

    it('should show error when no package manager specified', async () => {
      await cmdSfw.run([], importMeta, context)

      expect(mockLogger.fail).toHaveBeenCalledWith(
        'No package manager command specified.',
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Usage: socket sfw <package-manager> [args...]',
      )
      expect(process.exitCode).toBe(2)
    })

    it('should filter Socket CLI flags', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      await cmdSfw.run(['--dry-run', 'npm', 'install'], importMeta, context)

      // Dry run should bail early.
      expect(mockSpawnSfw).not.toHaveBeenCalled()
    })

    it('should handle multiple package managers', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      // Test various package managers.
      for (const pm of [
        'npm',
        'pnpm',
        'yarn',
        'pip',
        'cargo',
        'go',
        'gem',
        'bundler',
        'nuget',
        'uv',
      ]) {
        vi.clearAllMocks()
        await cmdSfw.run([pm, 'install'], importMeta, context)
        expect(mockSpawnSfw).toHaveBeenCalledWith([pm, 'install'], {
          stdio: 'inherit',
        })
      }
    })

    it('shows wrapper help when --help is passed and skips spawn', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0))

      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {
          throw new Error('process.exit')
        }) as never)

      try {
        await cmdSfw
          .run(['--help'], importMeta, context)
          .catch(() => undefined)
        expect(mockSpawnSfw).not.toHaveBeenCalled()
      } finally {
        exitSpy.mockRestore()
      }
    })

    it('forwards spawn signal via process.kill when present', async () => {
      mockSpawnSfw.mockResolvedValue(createMockSpawnResult(0, 'SIGTERM'))
      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => true) as any)

      try {
        await cmdSfw.run(['npm', 'install'], importMeta, context)
        expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
      } finally {
        killSpy.mockRestore()
      }
    })

    it('does nothing when both code and signal are null', async () => {
      // Construct a result with both code: null and signal: null (rare).
      mockSpawnSfw.mockResolvedValue({
        spawnPromise: Promise.resolve({
          code: undefined,
          signal: undefined,
          success: false,
        }),
      } as any)
      process.exitCode = undefined

      const killSpy = vi
        .spyOn(process, 'kill')
        .mockImplementation((() => true) as any)
      killSpy.mockClear()

      await cmdSfw.run(['npm', 'install'], importMeta, context)

      expect(killSpy).not.toHaveBeenCalled()
      killSpy.mockRestore()
    })
  })
})
