/**
 * Unit tests for manifest setup command.
 *
 * Tests the command that starts an interactive configurator to customize default
 * flag values for manifest commands in a directory. Configuration is stored in
 * socket.json for persistent settings.
 *
 * Test Coverage:
 * - Command metadata (description, hidden)
 * - Dry-run behavior with detailed output
 * - Path resolution (relative to absolute)
 * - Default path handling (current directory)
 * - Flag parsing (defaultOnReadError)
 * - Handler invocation with correct parameters
 *
 * Related Files:
 * - src/commands/manifest/cmd-manifest-setup.mts - Command implementation
 * - src/commands/manifest/handle-manifest-setup.mts - Setup logic
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

// Mock handleManifestSetup.
const mockHandleManifestSetup = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)

vi.mock('../../../../src/commands/manifest/handle-manifest-setup.mts', () => ({
  handleManifestSetup: mockHandleManifestSetup,
}))

// Mock outputDryRunWrite to verify dry-run output.
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}))

// Import after mocks.
const { cmdManifestSetup } =
  await import('../../../../src/commands/manifest/cmd-manifest-setup.mts')

describe('cmd-manifest-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdManifestSetup.description).toBe(
        'Start interactive configurator to customize default flag values for `socket manifest` in this dir',
      )
    })

    it('should not be hidden', () => {
      expect(cmdManifestSetup.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-manifest-setup.mts' }
    const context = { parentName: 'socket manifest' }

    describe('dry-run behavior', () => {
      it('should show dry-run output without executing setup', async () => {
        await cmdManifestSetup.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringContaining('socket.json'),
          'create or update manifest configuration',
          [
            'Detect supported ecosystems',
            'Configure manifest generation defaults',
            'Enable/disable specific ecosystems',
          ],
        )
        expect(mockHandleManifestSetup).not.toHaveBeenCalled()
      })

      it('should use provided path in dry-run output', async () => {
        await cmdManifestSetup.run(
          ['--dry-run', './custom/path'],
          importMeta,
          context,
        )

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringMatching(/custom\/path\/socket\.json$/),
          expect.any(String),
          expect.any(Array),
        )
      })

      it('should use current directory in dry-run when no path provided', async () => {
        await cmdManifestSetup.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          expect.stringMatching(/socket\.json$/),
          expect.any(String),
          expect.any(Array),
        )
      })
    })

    describe('path resolution', () => {
      it('should resolve relative path to absolute', async () => {
        await cmdManifestSetup.run(['./relative/path'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/^\/.*relative\/path$/),
          false,
        )
      })

      it('should use current directory when no path provided', async () => {
        const originalCwd = process.cwd()

        await cmdManifestSetup.run([], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(originalCwd, false)
      })

      it('should not modify absolute paths', async () => {
        await cmdManifestSetup.run(['/absolute/path'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          '/absolute/path',
          false,
        )
      })

      it('should handle dot notation for current directory', async () => {
        const originalCwd = process.cwd()

        await cmdManifestSetup.run(['.'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(originalCwd, false)
      })
    })

    describe('flag handling', () => {
      it('should pass defaultOnReadError flag as true when set', async () => {
        await cmdManifestSetup.run(
          ['--defaultOnReadError'],
          importMeta,
          context,
        )

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.any(String),
          true,
        )
      })

      it('should pass defaultOnReadError as false by default', async () => {
        await cmdManifestSetup.run([], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.any(String),
          false,
        )
      })

      it('should handle both path and defaultOnReadError flag', async () => {
        await cmdManifestSetup.run(
          ['./custom', '--defaultOnReadError'],
          importMeta,
          context,
        )

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/custom$/),
          true,
        )
      })
    })

    describe('handler invocation', () => {
      it('should call handleManifestSetup with correct parameters', async () => {
        await cmdManifestSetup.run(['./test-dir'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledOnce()
        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/test-dir$/),
          false,
        )
      })

      it('should not call handler in dry-run mode', async () => {
        await cmdManifestSetup.run(
          ['--dry-run', './test-dir'],
          importMeta,
          context,
        )

        expect(mockHandleManifestSetup).not.toHaveBeenCalled()
      })

      it('should handle handler errors gracefully', async () => {
        const testError = new Error('Setup failed')
        mockHandleManifestSetup.mockRejectedValueOnce(testError)

        await expect(
          cmdManifestSetup.run([], importMeta, context),
        ).rejects.toThrow('Setup failed')
      })
    })

    describe('edge cases', () => {
      it('should handle multiple path arguments by using first one', async () => {
        await cmdManifestSetup.run(['./first', './second'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/first$/),
          false,
        )
      })

      it('should handle paths with spaces', async () => {
        await cmdManifestSetup.run(['./path with spaces'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/path with spaces$/),
          false,
        )
      })

      it('should handle nested relative paths', async () => {
        await cmdManifestSetup.run(['./a/b/c/d/e'], importMeta, context)

        expect(mockHandleManifestSetup).toHaveBeenCalledWith(
          expect.stringMatching(/a\/b\/c\/d\/e$/),
          false,
        )
      })
    })
  })
})
