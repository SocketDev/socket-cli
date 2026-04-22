/**
 * Unit tests for postinstallWrapper.
 *
 * Purpose:
 * Tests postinstall wrapper functionality. Validates automatic Socket scanning after package installation.
 *
 * Test Coverage:
 * - Core functionality validation
 * - Edge case handling
 * - Error scenarios
 * - Input validation
 *
 * Testing Approach:
 * Comprehensive unit testing of module functionality with mocked dependencies
 * where appropriate.
 *
 * Related Files:
 * - src/postinstallWrapper.mts (implementation)
 */

import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { postinstallWrapper } from '../../../../src/commands/wrapper/postinstall-wrapper.mts'

const mockLogger = vi.hoisted(() => ({
  fail: vi.fn(),
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => mockLogger,
  logger: mockLogger,
}))
vi.mock('@socketsecurity/lib/stdio/prompts', () => ({
  confirm: vi.fn(),
}))
vi.mock('../../../../src/commands/wrapper/add-socket-wrapper.mts', () => ({
  addSocketWrapper: vi.fn(),
}))
vi.mock(
  '../../../../src/commands/wrapper/check-socket-wrapper-setup.mts',
  () => ({
    checkSocketWrapperSetup: vi.fn(),
  }),
)
vi.mock('../../../../src/constants/paths.mts', () => ({
  getBashRcPath: vi.fn(() => '/home/user/.bashrc'),
  getZshRcPath: vi.fn(() => '/home/user/.zshrc'),
}))
vi.mock('../../../../src/utils/cli/completion.mts', () => ({
  getBashrcDetails: vi.fn(),
}))
vi.mock('../../../../src/commands/install/setup-tab-completion.mts', () => ({
  updateInstalledTabCompletionScript: vi.fn(),
}))
vi.mock('../../../../src/utils/error/errors.mts', () => ({
  getErrorCause: vi.fn(e => e?.message || String(e)),
  InputError: class InputError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'InputError'
    }
  },
}))

describe('postinstallWrapper', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    existsSyncSpy = vi.spyOn(fs, 'existsSync')
  })

  afterEach(() => {
    existsSyncSpy.mockRestore()
  })

  it('skips setup when wrapper already enabled in bashrc', async () => {
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockImplementation(
      (path: string) => path === '/home/user/.bashrc',
    )
    mockCheckSetup.mockReturnValue(true)

    await postinstallWrapper()

    expect(checkSocketWrapperSetup).toHaveBeenCalledWith('/home/user/.bashrc')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('skips setup when wrapper already enabled in zshrc', async () => {
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockImplementation(
      (path: string) => path === '/home/user/.zshrc',
    )
    mockCheckSetup.mockImplementation(
      (path: string) => path === '/home/user/.zshrc',
    )

    await postinstallWrapper()

    expect(checkSocketWrapperSetup).toHaveBeenCalledWith('/home/user/.zshrc')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('prompts for setup when wrapper not enabled', async () => {
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    await import('@socketsecurity/lib/logger')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)

    existsSyncSpy.mockReturnValue(false)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(false)

    await postinstallWrapper()

    expect(confirm).toHaveBeenCalledWith({
      message: expect.stringContaining(
        'Do you want to install the Socket npm wrapper',
      ),
      default: true,
    })
    expect(mockLogger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Run `socket install completion` to setup bash tab completion',
      ),
    )
  })

  it('sets up wrapper when user confirms for bashrc', async () => {
    const { addSocketWrapper } =
      await import('../../../../src/commands/wrapper/add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)
    const _mockAddWrapper = vi.mocked(addSocketWrapper)

    existsSyncSpy.mockImplementation(
      (path: string) => path === '/home/user/.bashrc',
    )
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)

    await postinstallWrapper()

    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.bashrc')
  })

  it('sets up wrapper for both bashrc and zshrc when both exist', async () => {
    const { addSocketWrapper } =
      await import('../../../../src/commands/wrapper/add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)

    existsSyncSpy.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)

    await postinstallWrapper()

    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.bashrc')
    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.zshrc')
  })

  it('handles error during wrapper setup', async () => {
    const { addSocketWrapper } =
      await import('../../../../src/commands/wrapper/add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const { confirm } = await import('@socketsecurity/lib/stdio/prompts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)
    const mockAddWrapper = vi.mocked(addSocketWrapper)

    existsSyncSpy.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)
    mockAddWrapper.mockImplementation(() => {
      throw new Error('Permission denied')
    })

    await expect(postinstallWrapper()).rejects.toThrow(
      /failed to add socket aliases to .* \(Permission denied\)/,
    )
  })

  it('updates tab completion when it exists', async () => {
    const { getBashrcDetails } =
      await import('../../../../src/utils/cli/completion.mts')
    await import('@socketsecurity/lib/logger')
    const { updateInstalledTabCompletionScript } =
      await import('../../../../src/commands/install/setup-tab-completion.mts')
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const mockUpdateScript = vi.mocked(updateInstalledTabCompletionScript)
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true) // Wrapper already setup.
    mockGetDetails.mockReturnValue({
      ok: true,
      data: { targetPath: '/home/user/.config/socket/tab-completion.bash' },
    } as any)
    mockUpdateScript.mockReturnValue({ ok: true } as any)

    await postinstallWrapper()

    expect(updateInstalledTabCompletionScript).toHaveBeenCalledWith(
      '/home/user/.config/socket/tab-completion.bash',
    )
    expect(mockLogger.success).toHaveBeenCalledWith(
      'Updated the installed Socket tab completion script',
    )
  })

  it('skips tab completion update when file does not exist', async () => {
    const { getBashrcDetails } =
      await import('../../../../src/utils/cli/completion.mts')
    await import('@socketsecurity/lib/logger')
    const { updateInstalledTabCompletionScript } =
      await import('../../../../src/commands/install/setup-tab-completion.mts')
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockImplementation(
      (p: string) =>
        p !== '/home/user/.config/socket/tab-completion.bash',
    )
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockReturnValue({
      ok: true,
      data: { targetPath: '/home/user/.config/socket/tab-completion.bash' },
    } as any)

    await postinstallWrapper()

    expect(updateInstalledTabCompletionScript).not.toHaveBeenCalled()
    expect(mockLogger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })

  it('handles tab completion update failure gracefully', async () => {
    const { getBashrcDetails } =
      await import('../../../../src/utils/cli/completion.mts')
    await import('@socketsecurity/lib/logger')
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockImplementation(() => {
      throw new Error('Tab completion error')
    })

    await postinstallWrapper()

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })

  it('handles getBashrcDetails returning not ok', async () => {
    const { getBashrcDetails } =
      await import('../../../../src/utils/cli/completion.mts')
    await import('@socketsecurity/lib/logger')
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } =
      await import('../../../../src/commands/wrapper/check-socket-wrapper-setup.mts')
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    existsSyncSpy.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockReturnValue({ ok: false, message: 'Not found' } as any)

    await postinstallWrapper()

    expect(mockLogger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })
})
