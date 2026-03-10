/**
 * Unit tests for wrapper command.
 *
 * Tests the command that enables/disables the Socket npm/npx wrapper.
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
  LOG_SYMBOLS: {
    success: '✓',
    fail: '✗',
  },
  getDefaultLogger: () => mockLogger,
}))

// Mock dependencies.
const mockAddSocketWrapper = vi.hoisted(() => vi.fn())
const mockRemoveSocketWrapper = vi.hoisted(() => vi.fn())
const mockCheckSocketWrapperSetup = vi.hoisted(() =>
  vi.fn().mockReturnValue(false),
)
const mockPostinstallWrapper = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockGetBashRcPath = vi.hoisted(() =>
  vi.fn().mockReturnValue('/home/user/.bashrc'),
)
const mockGetZshRcPath = vi.hoisted(() =>
  vi.fn().mockReturnValue('/home/user/.zshrc'),
)

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: mockExistsSync,
  }
})

vi.mock('../../../../src/commands/wrapper/add-socket-wrapper.mts', () => ({
  addSocketWrapper: mockAddSocketWrapper,
}))

vi.mock('../../../../src/commands/wrapper/remove-socket-wrapper.mts', () => ({
  removeSocketWrapper: mockRemoveSocketWrapper,
}))

vi.mock(
  '../../../../src/commands/wrapper/check-socket-wrapper-setup.mts',
  () => ({
    checkSocketWrapperSetup: mockCheckSocketWrapperSetup,
  }),
)

vi.mock('../../../../src/commands/wrapper/postinstall-wrapper.mts', () => ({
  postinstallWrapper: mockPostinstallWrapper,
}))

vi.mock('../../../../src/constants/paths.mts', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../../src/constants/paths.mts')>()
  return {
    ...actual,
    getBashRcPath: mockGetBashRcPath,
    getZshRcPath: mockGetZshRcPath,
  }
})

// Import after mocks.
const { cmdWrapper } =
  await import('../../../../src/commands/wrapper/cmd-wrapper.mts')

describe('cmd-wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    mockExistsSync.mockReturnValue(true)
    mockCheckSocketWrapperSetup.mockReturnValue(false)
  })

  describe('command metadata', () => {
    it('should have correct description', () => {
      expect(cmdWrapper.description).toBe(
        'Enable or disable the Socket npm/npx wrapper',
      )
    })

    it('should not be hidden', () => {
      expect(cmdWrapper.hidden).toBe(false)
    })
  })

  describe('run', () => {
    const importMeta = { url: 'file:///test/cmd-wrapper.mts' }
    const context = { parentName: 'socket' }

    it('should support --dry-run flag with enable', async () => {
      await cmdWrapper.run(['on', '--dry-run'], importMeta, context)

      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should support --dry-run flag with disable', async () => {
      await cmdWrapper.run(['off', '--dry-run'], importMeta, context)

      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
      )
    })

    it('should fail without on/off argument', async () => {
      await cmdWrapper.run([], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should fail with invalid argument', async () => {
      await cmdWrapper.run(['invalid'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should fail with multiple arguments', async () => {
      await cmdWrapper.run(['on', 'off'], importMeta, context)

      expect(process.exitCode).toBe(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should enable wrapper with "on" argument', async () => {
      await cmdWrapper.run(['on'], importMeta, context)

      expect(mockAddSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should enable wrapper with "enable" argument', async () => {
      await cmdWrapper.run(['enable'], importMeta, context)

      expect(mockAddSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should enable wrapper with "enabled" argument', async () => {
      await cmdWrapper.run(['enabled'], importMeta, context)

      expect(mockAddSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should disable wrapper with "off" argument', async () => {
      await cmdWrapper.run(['off'], importMeta, context)

      expect(mockRemoveSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
    })

    it('should disable wrapper with "disable" argument', async () => {
      await cmdWrapper.run(['disable'], importMeta, context)

      expect(mockRemoveSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
    })

    it('should disable wrapper with "disabled" argument', async () => {
      await cmdWrapper.run(['disabled'], importMeta, context)

      expect(mockRemoveSocketWrapper).toHaveBeenCalledTimes(2)
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
    })

    it('should skip already configured files when enabling', async () => {
      mockCheckSocketWrapperSetup.mockReturnValue(true)

      await cmdWrapper.run(['on'], importMeta, context)

      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
    })

    it('should add wrapper to bashrc when it exists', async () => {
      mockExistsSync.mockImplementation(
        (path: string) => path === '/home/user/.bashrc',
      )

      await cmdWrapper.run(['on'], importMeta, context)

      expect(mockAddSocketWrapper).toHaveBeenCalledWith('/home/user/.bashrc')
    })

    it('should add wrapper to zshrc when it exists', async () => {
      mockExistsSync.mockImplementation(
        (path: string) => path === '/home/user/.zshrc',
      )

      await cmdWrapper.run(['on'], importMeta, context)

      expect(mockAddSocketWrapper).toHaveBeenCalledWith('/home/user/.zshrc')
    })

    it('should fail when no shell config files exist', async () => {
      mockExistsSync.mockReturnValue(false)

      await cmdWrapper.run(['on'], importMeta, context)

      expect(mockLogger.fail).toHaveBeenCalledWith(
        expect.stringContaining('bash profile'),
      )
    })

    it('should handle --postinstall argument', async () => {
      await cmdWrapper.run(['--postinstall'], importMeta, context)

      expect(mockPostinstallWrapper).toHaveBeenCalled()
      expect(mockAddSocketWrapper).not.toHaveBeenCalled()
      expect(mockRemoveSocketWrapper).not.toHaveBeenCalled()
    })

    it('should output JSON when --json flag is set', async () => {
      await cmdWrapper.run(['on', '--json'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"action"'),
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"enabled"'),
      )
    })

    it('should output markdown when --markdown flag is set', async () => {
      await cmdWrapper.run(['on', '--markdown'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('# Socket Wrapper Enabled'),
      )
    })

    it('should show disabled status in JSON output', async () => {
      await cmdWrapper.run(['off', '--json'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('"disabled"'),
      )
    })

    it('should show disabled status in markdown output', async () => {
      await cmdWrapper.run(['off', '--markdown'], importMeta, context)

      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('# Socket Wrapper Disabled'),
      )
    })
  })
})
