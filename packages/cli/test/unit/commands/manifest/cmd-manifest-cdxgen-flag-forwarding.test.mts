/**
 * Unit tests for manifest cdxgen command.
 *
 * Tests flag handling for the cdxgen command that generates CycloneDX SBOMs
 * (Software Bill of Materials): help flag handling, cdxgen flag forwarding,
 * path argument handling, Socket-specific flag filtering, and edge cases.
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

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-cdxgen.mts' }
    const context = { parentName: 'socket manifest' }

    describe('help flag handling', () => {
      it('should pass --help flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['--help'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            help: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should pass -h flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['-h'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            help: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should not set lifecycle/output defaults when --help is passed', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['--type', 'npm', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            type: ['npm'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward multiple --type flags to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['--print', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            print: true,
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --no-recurse flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['--no-recurse', '.'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            recurse: false,
          }),
        )

        mockExit.mockRestore()
      })

      it('should forward --spec-version flag to cdxgen', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['./my-project'], importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalledWith(
          expect.objectContaining({
            _: ['./my-project'],
          }),
        )

        mockExit.mockRestore()
      })

      it('should accept multiple paths', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

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
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        const readonlyArgv = Object.freeze(['.']) as readonly string[]

        await cmdManifestCdxgen.run(readonlyArgv, importMeta, context)

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })

      it('should handle empty context object', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, {})

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })

      it('should handle context with additional properties', async () => {
        const mockSpawnPromise = Promise.resolve({ code: 0, signal: undefined })
        mockRunCdxgen.mockResolvedValue({ spawnPromise: mockSpawnPromise })

        const mockExit = vi
          .spyOn(process, 'exit')
          .mockImplementation((() => {}) as unknown)

        await cmdManifestCdxgen.run(['.'], importMeta, {
          parentName: 'socket manifest',
          extraProp: 'ignored',
        } as unknown)

        expect(mockRunCdxgen).toHaveBeenCalled()

        mockExit.mockRestore()
      })
    })
  })
})
