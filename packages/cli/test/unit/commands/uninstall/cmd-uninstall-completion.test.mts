/**
 * Unit tests for uninstall completion command.
 *
 * Tests the command that uninstalls bash tab completion for Socket CLI.
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
const mockHandleUninstallCompletion = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockOutputDryRunDelete = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/uninstall/handle-uninstall-completion.mts', () => ({
  handleUninstallCompletion: mockHandleUninstallCompletion,
}))

vi.mock('../../../../src/utils/dry-run/output.mts', () => ({
  outputDryRunDelete: mockOutputDryRunDelete,
}))

// Import after mocks.
const { cmdUninstallCompletion } = await import(
  '../../../../src/commands/uninstall/cmd-uninstall-completion.mts'
)

describe('cmd-uninstall-completion', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = originalExitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdUninstallCompletion.description).toBe('Uninstall bash completion for Socket CLI')
    })

    it('should not be hidden', () => {
      expect(cmdUninstallCompletion.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-uninstall-completion.mts' }
    const context = { parentName: 'socket uninstall' }

    it('should use default target name "socket" when no name provided', async () => {
      await cmdUninstallCompletion.run([], importMeta, context)

      expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket')
    })

    it('should use custom target name when provided', async () => {
      await cmdUninstallCompletion.run(['sd'], importMeta, context)

      expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('sd')
    })

    it('should handle command name with special characters', async () => {
      await cmdUninstallCompletion.run(['socket-dev'], importMeta, context)

      expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket-dev')
    })

    describe('dry-run mode', () => {
      it('should output dry-run message for default target', async () => {
        await cmdUninstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalledWith(
          'bash completion',
          'completion for "socket" from ~/.bashrc',
        )
        expect(mockHandleUninstallCompletion).not.toHaveBeenCalled()
      })

      it('should output dry-run message for custom target', async () => {
        await cmdUninstallCompletion.run(['sd', '--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalledWith(
          'bash completion',
          'completion for "sd" from ~/.bashrc',
        )
        expect(mockHandleUninstallCompletion).not.toHaveBeenCalled()
      })

      it('should return early and not call handler in dry-run mode', async () => {
        await cmdUninstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockHandleUninstallCompletion).not.toHaveBeenCalled()
      })

      it('should include correct resource type in dry-run output', async () => {
        await cmdUninstallCompletion.run(['--dry-run'], importMeta, context)

        const [resourceType] = mockOutputDryRunDelete.mock.calls[0]
        expect(resourceType).toBe('bash completion')
      })

      it('should include target file path in dry-run identifier', async () => {
        await cmdUninstallCompletion.run(['my-cmd', '--dry-run'], importMeta, context)

        const [, identifier] = mockOutputDryRunDelete.mock.calls[0]
        expect(identifier).toContain('my-cmd')
        expect(identifier).toContain('~/.bashrc')
      })
    })

    describe('actual execution', () => {
      it('should call handleUninstallCompletion without dry-run', async () => {
        await cmdUninstallCompletion.run([], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledTimes(1)
        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket')
      })

      it('should not output dry-run message during actual execution', async () => {
        await cmdUninstallCompletion.run([], importMeta, context)

        expect(mockOutputDryRunDelete).not.toHaveBeenCalled()
      })

      it('should convert target name to string', async () => {
        await cmdUninstallCompletion.run(['test-cmd'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('test-cmd')
        expect(typeof mockHandleUninstallCompletion.mock.calls[0][0]).toBe('string')
      })
    })

    describe('flag parsing', () => {
      it('should handle --dry-run flag correctly', async () => {
        await cmdUninstallCompletion.run(['--dry-run'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalled()
        expect(mockHandleUninstallCompletion).not.toHaveBeenCalled()
      })

      it('should handle --dryRun flag correctly', async () => {
        await cmdUninstallCompletion.run(['--dryRun'], importMeta, context)

        expect(mockOutputDryRunDelete).toHaveBeenCalled()
        expect(mockHandleUninstallCompletion).not.toHaveBeenCalled()
      })

      it('should prioritize first input argument as target name', async () => {
        await cmdUninstallCompletion.run(['custom', 'ignored'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('custom')
      })
    })

    describe('edge cases', () => {
      it('should handle empty string as target name', async () => {
        await cmdUninstallCompletion.run([''], importMeta, context)

        // Empty string should be converted to string "socket" as default.
        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket')
      })

      it('should handle whitespace-only target name', async () => {
        await cmdUninstallCompletion.run(['   '], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('   ')
      })

      it('should handle target name with path separators', async () => {
        await cmdUninstallCompletion.run(['./custom-socket'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('./custom-socket')
      })

      it('should handle target name with special shell characters', async () => {
        await cmdUninstallCompletion.run(['socket$dev'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket$dev')
      })
    })

    describe('multiple arguments', () => {
      it('should only use first argument as target name', async () => {
        await cmdUninstallCompletion.run(['first', 'second', 'third'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('first')
      })

      it('should ignore extra arguments after target name', async () => {
        await cmdUninstallCompletion.run(['socket', '--extra'], importMeta, context)

        expect(mockHandleUninstallCompletion).toHaveBeenCalledWith('socket')
      })
    })
  })
})
