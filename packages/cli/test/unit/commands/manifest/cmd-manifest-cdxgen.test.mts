/**
 * Unit tests for manifest cdxgen command.
 *
 * Tests the cdxgen command that generates CycloneDX SBOMs (Software Bill of Materials).
 * This command wraps the @cyclonedx/cdxgen tool with Socket CLI integration.
 *
 * Test Coverage:
 * - Command metadata (description, hidden)
 * - Dry-run behavior
 * - Unknown argument handling
 * - Exit code handling with process.exit()
 * - Signal propagation with process.kill()
 * - Lifecycle default setting
 * - Output file defaults
 * - Help flag handling
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-cdxgen.mts - Command implementation
 * - src/commands/manifest/run-cdxgen.mts - cdxgen spawning logic
 */

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

// Mock runCdxgen to prevent actual cdxgen execution.
const mockRunCdxgen = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/manifest/run-cdxgen.mts', () => ({
  runCdxgen: mockRunCdxgen,
}))

// Import after mocks.
const { cmdManifestCdxgen } =
  await import('../../../../src/commands/manifest/cmd-manifest-cdxgen.mts')

describe('cmd-manifest-cdxgen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestCdxgen.description).toBe(
        'Run cdxgen for SBOM generation',
      )
    })

    it('should not be hidden', () => {
      expect(cmdManifestCdxgen.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-cdxgen.mts' }
    const context = { parentName: 'socket manifest' }

    it('should support --dry-run flag', async () => {
      await cmdManifestCdxgen.run(['--dry-run'], importMeta, context)

      // Dry run should not call runCdxgen.
      expect(mockRunCdxgen).not.toHaveBeenCalled()
      // Should log the dry run message.
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should show command args in dry-run output', async () => {
      await cmdManifestCdxgen.run(
        ['--dry-run', '--type', 'npm', './project'],
        importMeta,
        context,
      )

      expect(mockRunCdxgen).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Command: cdxgen'),
      )
    })

    it('should fail on unknown arguments', async () => {
      await cmdManifestCdxgen.run(['unknown-fake-arg'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unknown argument'),
      )
      expect(mockRunCdxgen).not.toHaveBeenCalled()
    })

    it('should fail on multiple unknown arguments', async () => {
      await cmdManifestCdxgen.run(
        ['fake-arg-1', 'fake-arg-2'],
        importMeta,
        context,
      )

      expect(process.exitCode).toBe(2)
      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('Unknown arguments'),
      )
    })

    describe('exit code handling', () => {
      it('should call process.exit with exit code 0 on success', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(0)
        mockExit.mockRestore()
      })

      it('should call process.exit with non-zero exit code on failure', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 1, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(1)
        mockExit.mockRestore()
      })

      it('should propagate specific exit code from cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 42, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(42)
        mockExit.mockRestore()
      })

      it('should set default exit code to 1 before spawning', async () => {
        let exitCodeDuringSpawn: number | undefined

        mockRunCdxgen.mockImplementation(() => {
          exitCodeDuringSpawn = process.exitCode
          return Promise.resolve({
            spawnPromise: Promise.resolve({ code: 0, signal: null }),
          })
        })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(exitCodeDuringSpawn).toBe(1)
        mockExit.mockRestore()
      })
    })

    describe('signal handling', () => {
      it('should call process.kill with signal when cdxgen receives SIGTERM', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: null,
          signal: 'SIGTERM',
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
        mockKill.mockRestore()
      })

      it('should call process.kill with SIGINT signal', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: null,
          signal: 'SIGINT',
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
        mockKill.mockRestore()
      })
    })

    describe('lifecycle defaults', () => {
      it('should set lifecycle to pre-build by default', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            lifecycle: 'pre-build',
            'install-deps': false,
          }),
        )

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining('Setting cdxgen --lifecycle to "pre-build"'),
        )

        mockExit.mockRestore()
      })

      it('should set output to socket-cdx.json by default', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            output: 'socket-cdx.json',
          }),
        )

        mockExit.mockRestore()
      })

      it('should not override lifecycle when explicitly set', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['--lifecycle', 'build', '.'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            lifecycle: 'build',
          }),
        )

        // Should not log the default lifecycle message.
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.stringContaining('Setting cdxgen --lifecycle'),
        )

        mockExit.mockRestore()
      })

      it('should not override output when explicitly set', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['--output', 'custom.json', '.'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            output: 'custom.json',
          }),
        )

        mockExit.mockRestore()
      })
    })

    describe('help flag handling', () => {
      it('should pass --help flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--help'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            help: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should pass -h flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['-h'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            help: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should not set lifecycle/output defaults when --help is passed', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--help'], importMeta, context)

        const callArg = mockRunCdxgen.mock.calls[0]?.[0]

        // Should have help but not lifecycle/output defaults.
        expect(callArg.help).toBe(true)
        expect(callArg.lifecycle).toBeUndefined()
        // Output is undefined because help is true.
        expect(callArg.output).toBeUndefined()

        mockExit.mockRestore()
      })
    })

    describe('cdxgen flag forwarding', () => {
      it('should forward --type flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--type', 'npm', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            type: ['npm'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward multiple --type flags to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['--type', 'npm', '--type', 'pypi', '.'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            type: ['npm', 'pypi'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --print flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--print', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            print: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --no-recurse flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--no-recurse', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            recurse: false,
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --spec-version flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['--spec-version', '1.5', '.'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            'spec-version': '1.5',
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --deep flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--deep', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            deep: true,
          }),
        )

        mockExit.mockRestore()
      })
    })

    describe('path argument handling', () => {
      it('should accept path as positional argument', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['./my-project'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            _: ['./my-project'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should accept multiple paths', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['./project1', './project2'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            _: ['./project1', './project2'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should accept absolute paths', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['/absolute/path/to/project'],
          importMeta,
          context,
        )

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            _: ['/absolute/path/to/project'],
          }),
        )

        mockExit.mockRestore()
      })
    })

    describe('Socket flag filtering', () => {
      it('should filter out --config flag from cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(
          ['--config', '{}', '.'],
          importMeta,
          context,
        )

        const callArg = mockRunCdxgen.mock.calls[0]?.[0]
        expect(callArg.config).toBeUndefined()

        mockExit.mockRestore()
      })

      it('should keep --no-banner flag for cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['--no-banner', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            banner: false,
          }),
        )

        mockExit.mockRestore()
      })
    })

    describe('edge cases', () => {
      it('should handle readonly argv array', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        const readonlyArgv = Object.freeze(['.']) as readonly string[]

        await cmdManifestCdxgen.run(readonlyArgv, importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })

      it('should handle empty context object', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, {})

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })

      it('should handle context with additional properties', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: null })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as any)

        await cmdManifestCdxgen.run(['.'], importMeta, {
          parentName: 'socket manifest',
          extraProp: 'ignored',
        } as any)

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })
    })
  })
})
