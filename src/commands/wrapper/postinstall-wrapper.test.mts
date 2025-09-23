import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs, { existsSync } from 'node:fs'

import { postinstallWrapper } from './postinstall-wrapper.mts'

// Mock the dependencies.
vi.mock('node:fs')
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    log: vi.fn(),
    success: vi.fn(),
  },
}))
vi.mock('@socketsecurity/registry/lib/prompts', () => ({
  confirm: vi.fn(),
}))
vi.mock('./add-socket-wrapper.mts', () => ({
  addSocketWrapper: vi.fn(),
}))
vi.mock('./check-socket-wrapper-setup.mts', () => ({
  checkSocketWrapperSetup: vi.fn(),
}))
vi.mock('../../constants.mts', () => {
  const kInternalsSymbol = Symbol.for('kInternalsSymbol')
  return {
    default: {
      bashRcPath: '/home/user/.bashrc',
      zshRcPath: '/home/user/.zshrc',
      kInternalsSymbol,
      [kInternalsSymbol as any]: {
        getSentry: vi.fn().mockReturnValue(undefined),
      },
    },
  }
})
vi.mock('../../utils/completion.mts', () => ({
  getBashrcDetails: vi.fn(),
}))
vi.mock('../install/setup-tab-completion.mts', () => ({
  updateInstalledTabCompletionScript: vi.fn(),
}))
vi.mock('../../utils/errors.mts', () => ({
  getErrorCause: vi.fn(e => e?.message || String(e)),
}))

describe('postinstallWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips setup when wrapper already enabled in bashrc', async () => {
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockImplementation(
      (path: string) => path === '/home/user/.bashrc',
    )
    mockCheckSetup.mockReturnValue(true)

    await postinstallWrapper()

    expect(checkSocketWrapperSetup).toHaveBeenCalledWith('/home/user/.bashrc')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('skips setup when wrapper already enabled in zshrc', async () => {
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockImplementation(
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
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)

    mockExistsSync.mockReturnValue(false)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(false)

    await postinstallWrapper()

    expect(confirm).toHaveBeenCalledWith({
      message: expect.stringContaining(
        'Do you want to install the Socket npm wrapper',
      ),
      default: true,
    })
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Run `socket install completion` to setup bash tab completion',
      ),
    )
  })

  it('sets up wrapper when user confirms for bashrc', async () => {
    const { addSocketWrapper } = await import('./add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)
    const mockAddWrapper = vi.mocked(addSocketWrapper)

    mockExistsSync.mockImplementation(
      (path: string) => path === '/home/user/.bashrc',
    )
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)

    await postinstallWrapper()

    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.bashrc')
  })

  it('sets up wrapper for both bashrc and zshrc when both exist', async () => {
    const { addSocketWrapper } = await import('./add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)

    await postinstallWrapper()

    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.bashrc')
    expect(addSocketWrapper).toHaveBeenCalledWith('/home/user/.zshrc')
  })

  it('handles error during wrapper setup', async () => {
    const { addSocketWrapper } = await import('./add-socket-wrapper.mts')
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const { confirm } = await import('@socketsecurity/registry/lib/prompts')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)
    const mockConfirm = vi.mocked(confirm)
    const mockAddWrapper = vi.mocked(addSocketWrapper)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(false)
    mockConfirm.mockResolvedValue(true)
    mockAddWrapper.mockImplementation(() => {
      throw new Error('Permission denied')
    })

    await expect(postinstallWrapper()).rejects.toThrow(
      'There was an issue setting up the alias: Permission denied',
    )
  })

  it('updates tab completion when it exists', async () => {
    const { getBashrcDetails } = await import('../../utils/completion.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { updateInstalledTabCompletionScript } = await import(
      '../install/setup-tab-completion.mts'
    )
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockFsExistsSync = vi.mocked(fs.existsSync) as any
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const mockUpdateScript = vi.mocked(updateInstalledTabCompletionScript)
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true) // Wrapper already setup.
    mockGetDetails.mockReturnValue({
      ok: true,
      data: { targetPath: '/home/user/.config/socket/tab-completion.bash' },
    } as any)
    mockFsExistsSync.mockReturnValue(true)
    mockUpdateScript.mockReturnValue({ ok: true } as any)

    await postinstallWrapper()

    expect(updateInstalledTabCompletionScript).toHaveBeenCalledWith(
      '/home/user/.config/socket/tab-completion.bash',
    )
    expect(logger.success).toHaveBeenCalledWith(
      'Updated the installed Socket tab completion script',
    )
  })

  it('skips tab completion update when file does not exist', async () => {
    const { getBashrcDetails } = await import('../../utils/completion.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const { updateInstalledTabCompletionScript } = await import(
      '../install/setup-tab-completion.mts'
    )
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockFsExistsSync = vi.mocked(fs.existsSync) as any
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockReturnValue({
      ok: true,
      data: { targetPath: '/home/user/.config/socket/tab-completion.bash' },
    } as any)
    mockFsExistsSync.mockReturnValue(false)

    await postinstallWrapper()

    expect(updateInstalledTabCompletionScript).not.toHaveBeenCalled()
    expect(logger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })

  it('handles tab completion update failure gracefully', async () => {
    const { getBashrcDetails } = await import('../../utils/completion.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockImplementation(() => {
      throw new Error('Tab completion error')
    })

    await postinstallWrapper()

    expect(logger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })

  it('handles getBashrcDetails returning not ok', async () => {
    const { getBashrcDetails } = await import('../../utils/completion.mts')
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockExistsSync = vi.mocked(existsSync) as any
    const mockGetDetails = vi.mocked(getBashrcDetails)
    const { checkSocketWrapperSetup } = await import(
      './check-socket-wrapper-setup.mts'
    )
    const mockCheckSetup = vi.mocked(checkSocketWrapperSetup)

    mockExistsSync.mockReturnValue(true)
    mockCheckSetup.mockReturnValue(true)
    mockGetDetails.mockReturnValue({ ok: false, message: 'Not found' } as any)

    await postinstallWrapper()

    expect(logger.log).toHaveBeenCalledWith(
      'Run `socket install completion` to setup bash tab completion',
    )
  })
})
