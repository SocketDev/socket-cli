/**
 * Unit tests for install completion command.
 *
 * Tests the command that installs bash tab completion for Socket CLI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Mock dependencies.
const mockHandleInstallCompletion = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
)
const mockOutputDryRunWrite = vi.hoisted(() => vi.fn())

vi.mock(
  '../../../../src/commands/install/handle-install-completion.mts',
  () => ({
    handleInstallCompletion: mockHandleInstallCompletion,
  }),
)

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunWrite: mockOutputDryRunWrite,
}))

// Import after mocks.
const { cmdInstallCompletion } =
  await import('../../../../src/commands/install/cmd-install-completion.mts')

describe('cmd-install-completion', () => {
  const originalEnv = process.env
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, HOME: '/home/testuser' }
    process.exitCode = originalExitCode
  })

  afterEach(() => {
    process.env = originalEnv
    process.exitCode = originalExitCode
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdInstallCompletion.description).toBe(
        'Install bash completion for Socket CLI',
      )
    })

    it('should not be hidden', () => {
      expect(cmdInstallCompletion.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-install-completion.mts' }
    const context = { parentName: 'socket install' }

    it('should use default target name "socket" when no name provided', async () => {
      await cmdInstallCompletion.run([], importMeta, context)

      expect(mockHandleInstallCompletion).toHaveBeenCalledWith('socket')
    })

    it('should use custom target name when provided', async () => {
      await cmdInstallCompletion.run(['sd'], importMeta, context)

      expect(mockHandleInstallCompletion).toHaveBeenCalledWith('sd')
    })

    it('should use relative path as target name', async () => {
      await cmdInstallCompletion.run(['./sd'], importMeta, context)

      expect(mockHandleInstallCompletion).toHaveBeenCalledWith('./sd')
    })

    it('should handle absolute path as target name', async () => {
      await cmdInstallCompletion.run(
        ['/usr/local/bin/socket'],
        importMeta,
        context,
      )

      expect(mockHandleInstallCompletion).toHaveBeenCalledWith(
        '/usr/local/bin/socket',
      )
    })

    describe('dry-run mode', () => {
      it('should output dry-run message for default target', async () => {
        await cmdInstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/home/testuser/.bashrc',
          'install bash completion for "socket"',
          [
            'Add completion script source command to ~/.bashrc',
            'Enable tab completion in current shell',
          ],
        )
        expect(mockHandleInstallCompletion).not.toHaveBeenCalled()
      })

      it('should output dry-run message for custom target', async () => {
        await cmdInstallCompletion.run(['sd', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/home/testuser/.bashrc',
          'install bash completion for "sd"',
          [
            'Add completion script source command to ~/.bashrc',
            'Enable tab completion in current shell',
          ],
        )
        expect(mockHandleInstallCompletion).not.toHaveBeenCalled()
      })

      it('should use HOME environment variable for bashrc path', async () => {
        process.env['HOME'] = '/custom/home'

        await cmdInstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalledWith(
          '/custom/home/.bashrc',
          expect.any(String),
          expect.any(Array),
        )
      })

      it('should return early and not call handler in dry-run mode', async () => {
        await cmdInstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockHandleInstallCompletion).not.toHaveBeenCalled()
      })
    })

    describe('actual execution', () => {
      it('should call handleInstallCompletion without dry-run', async () => {
        await cmdInstallCompletion.run([], importMeta, context)

        expect(mockHandleInstallCompletion).toHaveBeenCalledTimes(1)
        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('socket')
      })

      it('should not output dry-run message during actual execution', async () => {
        await cmdInstallCompletion.run([], importMeta, context)

        expect(mockOutputDryRunWrite).not.toHaveBeenCalled()
      })

      it('should convert target name to string', async () => {
        await cmdInstallCompletion.run(['test-cmd'], importMeta, context)

        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('test-cmd')
        expect(typeof mockHandleInstallCompletion.mock.calls[0][0]).toBe(
          'string',
        )
      })
    })

    describe('flag parsing', () => {
      it('should handle --dry-run flag correctly', async () => {
        await cmdInstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalled()
        expect(mockHandleInstallCompletion).not.toHaveBeenCalled()
      })

      it('should handle --dryRun flag correctly', async () => {
        await cmdInstallCompletion.run(['--dryRun'], importMeta, context)

        expect(mockOutputDryRunWrite).toHaveBeenCalled()
        expect(mockHandleInstallCompletion).not.toHaveBeenCalled()
      })

      it('should prioritize first input argument as target name', async () => {
        await cmdInstallCompletion.run(
          ['custom', 'ignored'],
          importMeta,
          context,
        )

        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('custom')
      })
    })

    describe('edge cases', () => {
      it('should handle empty string as target name', async () => {
        await cmdInstallCompletion.run([''], importMeta, context)

        // Empty string should be converted to string "socket" as default.
        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('socket')
      })

      it('should handle whitespace-only target name', async () => {
        await cmdInstallCompletion.run(['   '], importMeta, context)

        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('   ')
      })

      it('should handle target name with special characters', async () => {
        await cmdInstallCompletion.run(['socket-@dev'], importMeta, context)

        expect(mockHandleInstallCompletion).toHaveBeenCalledWith('socket-@dev')
      })
    })
  })
})
