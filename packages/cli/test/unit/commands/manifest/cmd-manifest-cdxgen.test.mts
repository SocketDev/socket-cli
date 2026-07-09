/**
 * Unit tests for manifest cdxgen command.
 *
 * Tests the cdxgen command that generates CycloneDX SBOMs (Software Bill of
 * Materials). This command wraps the @cyclonedx/cdxgen tool with Socket CLI
 * integration.
 *
 * Test Coverage: - Command metadata (description, hidden) - Dry-run behavior -
 * Unknown argument handling - Exit code handling with process.exit() - Signal
 * propagation with process.kill() - Lifecycle default setting - Empty-
 * components hard gate.
 *
 * Related Files: - src/commands/manifest/cmd-manifest-cdxgen.mts - Command
 * implementation - src/commands/manifest/run-cdxgen.mts - cdxgen spawning
 * logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { cmdManifestCdxgen } from '../../../../src/commands/manifest/cmd-manifest-cdxgen.mts'

// Mock the logger.
const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  fail: vi.fn(),
  info: vi.fn(),
  log: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
}))

vi.mock(import('@socketsecurity/lib-stable/logger/default'), () => ({
  getDefaultLogger: () => mockLogger,
}))

// Mock runCdxgen to prevent actual cdxgen execution.
const mockRunCdxgen = vi.hoisted(() => vi.fn())
const mockDetectNodejsCdxgenSources = vi.hoisted(() =>
  // Default to "sources available" so pre-existing tests don't trip the
  // empty-components hard gate.
  vi.fn().mockResolvedValue({ hasLockfile: true, hasNodeModules: true }),
)
const mockIsNodejsCdxgenType = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock(import('../../../../src/commands/manifest/run-cdxgen.mts'), () => ({
  detectNodejsCdxgenSources: mockDetectNodejsCdxgenSources,
  isNodejsCdxgenType: mockIsNodejsCdxgenType,
  runCdxgen: mockRunCdxgen,
}))

describe('cmd-manifest-cdxgen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectNodejsCdxgenSources.mockResolvedValue({
      hasLockfile: true,
      hasNodeModules: true,
    })
    mockIsNodejsCdxgenType.mockReturnValue(true)
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
      expect(mockLogger.error).toHaveBeenCalledWith(
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
      expect(mockLogger.error).toHaveBeenCalledWith(
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
      it('skips exit/kill when both code and signal are null', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: undefined,
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)
        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => true) as unknown)
        mockExit.mockClear()
        mockKill.mockClear()

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).not.toHaveBeenCalled()
        expect(mockKill).not.toHaveBeenCalled()
        mockExit.mockRestore()
        mockKill.mockRestore()
      })

      it('should call process.exit with exit code 0 on success', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(0)
        mockExit.mockRestore()
      })

      it('should call process.exit with non-zero exit code on failure', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 1, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(1)
        mockExit.mockRestore()
      })

      it('should propagate specific exit code from cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: 42,
          signal: undefined,
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockExit).toHaveBeenCalledWith(42)
        mockExit.mockRestore()
      })

      it('should set default exit code to 1 before spawning', async () => {
        let exitCodeDuringSpawn: number | undefined

        mockRunCdxgen.mockImplementation(() => {
          exitCodeDuringSpawn = process.exitCode
          return Promise.resolve({
            spawnPromise: Promise.resolve({ code: 0, signal: undefined }),
          })
        })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(exitCodeDuringSpawn).toBe(1)
        mockExit.mockRestore()
      })
    })

    describe('signal handling', () => {
      it('should call process.kill with signal when cdxgen receives SIGTERM', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: 'SIGTERM',
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
        mockKill.mockRestore()
      })

      it('should call process.kill with SIGINT signal', async () => {
        const mockSpawnPromise = Promise.resolve({
          code: undefined,
          signal: 'SIGINT',
        })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockKill = vi
          .spyOn(process, 'kill')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockKill).toHaveBeenCalledWith(process.pid, 'SIGINT')
        mockKill.mockRestore()
      })
    })

    describe('lifecycle defaults', () => {
      it('should set lifecycle to pre-build by default', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            output: 'socket-cdx.json',
          }),
        )

        mockExit.mockRestore()
      })

      it('should not override lifecycle when explicitly set', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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

    describe('empty-components hard gate', () => {
      it('fails when default pre-build path has no lockfile and no node_modules', async () => {
        mockDetectNodejsCdxgenSources.mockResolvedValue({
          hasLockfile: false,
          hasNodeModules: false,
        })

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(process.exitCode).toBe(2)
        expect(mockLogger.fail).toHaveBeenCalledWith(
          expect.stringContaining('no lockfile'),
        )
        expect(mockRunCdxgen).not.toHaveBeenCalled()
      })

      it('allows the run when only a lockfile is present', async () => {
        mockDetectNodejsCdxgenSources.mockResolvedValue({
          hasLockfile: true,
          hasNodeModules: false,
        })
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })
        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalled()
        mockExit.mockRestore()
      })

      it('allows the run when only node_modules/ is present', async () => {
        mockDetectNodejsCdxgenSources.mockResolvedValue({
          hasLockfile: false,
          hasNodeModules: true,
        })
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })
        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalled()
        mockExit.mockRestore()
      })

      it('skips the gate when user passes --lifecycle explicitly', async () => {
        mockDetectNodejsCdxgenSources.mockResolvedValue({
          hasLockfile: false,
          hasNodeModules: false,
        })
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })
        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(
          ['--lifecycle', 'build', '.'],
          importMeta,
          context,
        )

        expect(mockDetectNodejsCdxgenSources).not.toHaveBeenCalled()
        expect(mockRunCdxgen).toHaveBeenCalled()
        mockExit.mockRestore()
      })

      it('skips the gate for non-Node.js project types', async () => {
        mockIsNodejsCdxgenType.mockReturnValue(false)
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })
        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(
          ['--type', 'python', '.'],
          importMeta,
          context,
        )

        expect(mockDetectNodejsCdxgenSources).not.toHaveBeenCalled()
        expect(mockRunCdxgen).toHaveBeenCalled()
        mockExit.mockRestore()
      })
    })
  })
})
