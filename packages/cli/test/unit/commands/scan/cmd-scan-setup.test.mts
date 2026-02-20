/**
 * Unit tests for scan setup command.
 *
 * Tests the command that configures default flag values for socket scan.
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

// Mock handleScanConfig.
const mockHandleScanConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/scan/handle-scan-config.mts', () => ({
  handleScanConfig: mockHandleScanConfig,
}))

// Import after mocks.
const { cmdScanSetup } = await import(
  '../../../../src/commands/scan/cmd-scan-setup.mts'
)

describe('cmd-scan-setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdScanSetup.description).toContain('interactive configurator')
      expect(cmdScanSetup.description).toContain('socket scan')
    })

    it('should not be hidden', () => {
      expect(cmdScanSetup.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-scan-setup.mts' }
    const context = { parentName: 'socket scan' }

    it('should support --dry-run flag', async () => {
      await cmdScanSetup.run(['--dry-run'], importMeta, context)

      expect(mockHandleScanConfig).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call handleScanConfig with cwd', async () => {
      await cmdScanSetup.run(['.'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.stringContaining('/'),
        false,
      )
    })

    it('should pass defaultOnReadError flag', async () => {
      await cmdScanSetup.run(['--default-on-read-error'], importMeta, context)

      expect(mockHandleScanConfig).toHaveBeenCalledWith(
        expect.any(String),
        true,
      )
    })
  })
})
