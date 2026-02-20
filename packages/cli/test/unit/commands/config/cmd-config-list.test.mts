/**
 * Unit tests for config list command.
 *
 * Tests the command that displays all local CLI configuration items and values.
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

vi.mock('@socketsecurity/lib/logger', async importOriginal => {
  const actual = await importOriginal<typeof import('@socketsecurity/lib/logger')>()
  return {
    ...actual,
    getDefaultLogger: () => mockLogger,
  }
})

// Mock outputConfigList.
const mockOutputConfigList = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/commands/config/output-config-list.mts', () => ({
  outputConfigList: mockOutputConfigList,
}))

// Import after mocks.
const { cmdConfigList } = await import(
  '../../../../src/commands/config/cmd-config-list.mts'
)

describe('cmd-config-list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdConfigList.description).toBe(
        'Show all local CLI config items and their values',
      )
    })

    it('should not be hidden', () => {
      expect(cmdConfigList.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-config-list.mts' }
    const context = { parentName: 'socket config' }

    it('should support --dry-run flag', async () => {
      await cmdConfigList.run(['--dry-run'], importMeta, context)

      expect(mockOutputConfigList).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should call outputConfigList with default options', async () => {
      await cmdConfigList.run([], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledWith({
        full: false,
        outputKind: 'text',
      })
    })

    it('should pass full flag to outputConfigList', async () => {
      await cmdConfigList.run(['--full'], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledWith({
        full: true,
        outputKind: 'text',
      })
    })

    it('should support --json flag', async () => {
      await cmdConfigList.run(['--json'], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledWith({
        full: false,
        outputKind: 'json',
      })
    })

    it('should support --markdown flag', async () => {
      await cmdConfigList.run(['--markdown'], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledWith({
        full: false,
        outputKind: 'markdown',
      })
    })

    it('should support combined --full and --json flags', async () => {
      await cmdConfigList.run(['--full', '--json'], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledWith({
        full: true,
        outputKind: 'json',
      })
    })

    it('should reject conflicting --json and --markdown flags', async () => {
      await cmdConfigList.run(['--json', '--markdown'], importMeta, context)

      // Exit code 2 = invalid usage/validation failure.
      expect(process.exitCode).toBe(2)
      expect(mockOutputConfigList).not.toHaveBeenCalled()
    })

    it('should call outputConfigList exactly once per run', async () => {
      await cmdConfigList.run([], importMeta, context)

      expect(mockOutputConfigList).toHaveBeenCalledTimes(1)
    })
  })
})
