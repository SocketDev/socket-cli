/**
 * Unit tests for scan setup command.
 *
 * Tests the command that configures default flag values for socket scan.
 * Creates a local socket.json file to store scan configuration defaults.
 */

import path from 'node:path'

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

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock meowOrExit.
const mockMeowOrExit = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    input: [],
    flags: {},
  }),
)

vi.mock(
  '../../../../src/utils/cli/with-subcommands.mjs',
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/utils/cli/with-subcommands.mjs')
      >()
    return {
      ...actual,
      meowOrExit: mockMeowOrExit,
    }
  },
)

// Mock handleScanConfig.
const mockHandleScanConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/handle-scan-config.mts', () => ({
  handleScanConfig: mockHandleScanConfig,
}))

// Import after mocks.
const { cmdScanSetup } =
  await import('../../../../src/commands/scan/cmd-scan-setup.mts')

describe('cmd-scan-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    // Reset default mock return value.
    mockMeowOrExit.mockReturnValue({
      input: [],
      flags: {},
    })
  })

  describe('command metadata', () => {
    it('should have correct description mentioning interactive configurator', () => {
      expect(cmdScanSetup.description).toContain('interactive configurator')
    })

    it('should have correct description mentioning socket scan', () => {
      expect(cmdScanSetup.description).toContain('socket scan')
    })

    it('should not be hidden', () => {
      expect(cmdScanSetup.hidden).toBe(false)
    })
  })

  describe('meowOrExit configuration', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should call meowOrExit with correct commandName', async () => {
      await cmdScanSetup.run([], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            commandName: 'setup',
          }),
        }),
      )
    })

    it('should call meowOrExit with parentName from context', async () => {
      await cmdScanSetup.run([], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'socket scan',
        }),
      )
    })

    it('should call meowOrExit with importMeta', async () => {
      await cmdScanSetup.run([], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          importMeta,
        }),
      )
    })

    it('should call meowOrExit with argv', async () => {
      await cmdScanSetup.run(['--dry-run', '.'], importMeta, context)

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          argv: ['--dry-run', '.'],
        }),
      )
    })

    it('should include defaultOnReadError flag in config', async () => {
      await cmdScanSetup.run([], importMeta, context)

      const callArgs = mockMeowOrExit.mock.calls[0]?.[0]
      expect(callArgs?.config?.flags?.defaultOnReadError).toBeDefined()
      expect(callArgs?.config?.flags?.defaultOnReadError?.type).toBe('boolean')
    })

    it('should include help function with usage examples', async () => {
      await cmdScanSetup.run([], importMeta, context)

      const callArgs = mockMeowOrExit.mock.calls[0]?.[0]
      const helpText = callArgs?.config?.help?.(
        'socket scan setup',
        callArgs?.config,
      )

      expect(helpText).toContain('Usage')
      expect(helpText).toContain('$ socket scan setup [options] [CWD=.]')
      expect(helpText).toContain('Options')
      expect(helpText).toContain('Examples')
      expect(helpText).toContain('$ socket scan setup')
      expect(helpText).toContain('$ socket scan setup ./proj')
    })

    it('should mention socket.json in help text', async () => {
      await cmdScanSetup.run([], importMeta, context)

      const callArgs = mockMeowOrExit.mock.calls[0]?.[0]
      const helpText = callArgs?.config?.help?.(
        'socket scan setup',
        callArgs?.config,
      )

      expect(helpText).toContain('json file')
      expect(helpText).toContain('socket scan create')
    })
  })

  describe('dry-run behavior', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should log DryRun message and return early', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: [],
        flags: { dryRun: true },
      })

      await cmdScanSetup.run(['--dry-run'], importMeta, context)

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
      expect(mockHandleScanConfig).not.toHaveBeenCalled()
    })

    it('should not call handleScanConfig when dry-run is true', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['.'],
        flags: { dryRun: true },
      })

      await cmdScanSetup.run(['--dry-run', '.'], importMeta, context)

      expect(mockHandleScanConfig).not.toHaveBeenCalled()
    })
  })

  describe('cwd path handling', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should default to current directory when no input provided', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: [],
        flags: {},
      })

      await cmdScanSetup.run([], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(process.cwd(), false)
    })

    it('should resolve relative path from cwd', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['./subdir'],
        flags: {},
      })

      await cmdScanSetup.run(['./subdir'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        path.resolve(process.cwd(), './subdir'),
        false,
      )
    })

    it('should use absolute path as-is', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['/absolute/path'],
        flags: {},
      })

      await cmdScanSetup.run(['/absolute/path'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith('/absolute/path', false)
    })

    it('should resolve parent directory path', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['../parent'],
        flags: {},
      })

      await cmdScanSetup.run(['../parent'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        path.resolve(process.cwd(), '../parent'),
        false,
      )
    })

    it('should handle dot path', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['.'],
        flags: {},
      })

      await cmdScanSetup.run(['.'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(process.cwd(), false)
    })
  })

  describe('defaultOnReadError flag', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should pass false when flag is not provided', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['.'],
        flags: {},
      })

      await cmdScanSetup.run(['.'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        false,
      )
    })

    it('should pass true when flag is provided', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['.'],
        flags: { defaultOnReadError: true },
      })

      await cmdScanSetup.run(
        ['--default-on-read-error', '.'],
        importMeta,
        context,
      )

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        true,
      )
    })

    it('should coerce undefined to false', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: [],
        flags: { defaultOnReadError: undefined },
      })

      await cmdScanSetup.run([], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        false,
      )
    })

    it('should handle explicit false value', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: [],
        flags: { defaultOnReadError: false },
      })

      await cmdScanSetup.run([], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        false,
      )
    })
  })

  describe('integration of flags and path', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should handle both path and defaultOnReadError together', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['./project'],
        flags: { defaultOnReadError: true },
      })

      await cmdScanSetup.run(
        ['--default-on-read-error', './project'],
        importMeta,
        context,
      )

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        path.resolve(process.cwd(), './project'),
        true,
      )
    })

    it('should not pass additional flags to handleScanConfig', async () => {
      mockMeowOrExit.mockReturnValueOnce({
        input: ['.'],
        flags: {
          defaultOnReadError: true,
          somethingElse: 'value',
        },
      })

      await cmdScanSetup.run(['.'], importMeta, context)

      // handleScanConfig should only receive cwd and defaultOnReadError.
      expect(mockHandleScanConfig).toHaveBeenCalledTimes(1)
      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        true,
      )
    })
  })

  describe('context handling', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }

    it('should accept custom parentName', async () => {
      await cmdScanSetup.run([], importMeta, { parentName: 'custom-cli scan' })

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: 'custom-cli scan',
        }),
      )
    })

    it('should handle empty parentName', async () => {
      await cmdScanSetup.run([], importMeta, { parentName: '' })

      expect(mockMeowOrExit).toHaveBeenCalledWith(
        expect.objectContaining({
          parentName: '',
        }),
      )
    })
  })

  describe('error handling', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should propagate errors from handleScanConfig', async () => {
      const testError = new Error('Config write failed')
      mockHandleScanConfig.mockRejectedValueOnce(testError)

      await expect(
        cmdScanSetup.run(['.'], importMeta, context),
      ).rejects.toThrow('Config write failed')
    })

    it('should propagate errors from handleScanConfig with custom message', async () => {
      const testError = new Error('Permission denied')
      mockHandleScanConfig.mockRejectedValueOnce(testError)

      await expect(
        cmdScanSetup.run(['.'], importMeta, context),
      ).rejects.toThrow(testError)
    })
  })
})
