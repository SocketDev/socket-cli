import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'

import { removeSocketWrapper } from './remove-socket-wrapper.mts'

// Mock the dependencies.
vi.mock('node:fs')
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  },
}))

describe('removeSocketWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset mocked functions to have default no-op implementation.
    const mockWriteFileSync = vi.mocked(writeFileSync) as any
    mockWriteFileSync.mockImplementation(() => {})
  })

  it('successfully removes both aliases from file', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue(
      'alias npm="socket npm"\nalias npx="socket npx"\nother content',
    )

    removeSocketWrapper('/home/user/.bashrc')

    expect(readFileSync).toHaveBeenCalledWith('/home/user/.bashrc', 'utf8')
    expect(writeFileSync).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'other content',
      'utf8',
    )
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('The alias was removed from /home/user/.bashrc'),
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('restart existing terminal sessions'),
    )
  })

  it('removes only socket aliases, leaving others intact', () => {
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue(
      'alias ll="ls -la"\nalias npm="socket npm"\nalias gs="git status"\nalias npx="socket npx"',
    )

    removeSocketWrapper('/home/user/.zshrc')

    expect(writeFileSync).toHaveBeenCalledWith(
      '/home/user/.zshrc',
      'alias ll="ls -la"\nalias gs="git status"',
      'utf8',
    )
  })

  it('handles read error gracefully', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const readError = new Error('Permission denied')

    mockReadFileSync.mockImplementation(() => {
      throw readError
    })

    removeSocketWrapper('/etc/protected-file')

    expect(logger.fail).toHaveBeenCalledWith(
      expect.stringContaining('There was an error removing the alias'),
    )
    expect(logger.error).toHaveBeenCalledWith(readError)
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('handles write error gracefully', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any
    const writeError = new Error('Disk full')

    mockReadFileSync.mockReturnValue('alias npm="socket npm"')
    mockWriteFileSync.mockImplementation(() => {
      throw writeError
    })

    removeSocketWrapper('/home/user/.bashrc')

    expect(logger.error).toHaveBeenCalledWith(writeError)
    expect(logger.success).not.toHaveBeenCalled()
  })

  it('handles file with no socket aliases', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue('alias ll="ls -la"\nexport PATH=$PATH:/usr/local/bin')

    removeSocketWrapper('/home/user/.bashrc')

    // When no socket aliases are removed, success message is still shown.
    expect(writeFileSync).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'alias ll="ls -la"\nexport PATH=$PATH:/usr/local/bin',
      'utf8',
    )
    // File is written successfully, so success is logged.
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('The alias was removed from /home/user/.bashrc'),
    )
  })

  it('preserves empty lines when removing aliases', () => {
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue(
      '\nalias npm="socket npm"\n\nalias npx="socket npx"\n\nother content\n',
    )

    removeSocketWrapper('/home/user/.bashrc')

    expect(writeFileSync).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      '\n\n\nother content\n',
      'utf8',
    )
  })

  it('handles empty file', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue('')

    removeSocketWrapper('/home/user/.bashrc')

    expect(writeFileSync).toHaveBeenCalledWith('/home/user/.bashrc', '', 'utf8')
    // File is written successfully, so success is logged.
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('The alias was removed from /home/user/.bashrc'),
    )
  })

  it('removes only exact matches', () => {
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue(
      'alias npm="socket npm"\nalias npm2="socket npm"\nalias npx="socket npx"\nalias npx-extra="socket npx --extra"',
    )

    removeSocketWrapper('/home/user/.bashrc')

    expect(writeFileSync).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'alias npm2="socket npm"\nalias npx-extra="socket npx --extra"',
      'utf8',
    )
  })

  it('handles undefined error in read catch', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any

    mockReadFileSync.mockImplementation(() => {
      throw undefined
    })

    removeSocketWrapper('/home/user/.bashrc')

    expect(logger.fail).toHaveBeenCalledWith('There was an error removing the alias.')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('handles undefined error in write catch', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockReadFileSync = vi.mocked(readFileSync) as any
    const mockWriteFileSync = vi.mocked(writeFileSync) as any

    mockReadFileSync.mockReturnValue('alias npm="socket npm"')
    mockWriteFileSync.mockImplementation(() => {
      throw undefined
    })

    removeSocketWrapper('/home/user/.bashrc')

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.success).not.toHaveBeenCalled()
  })
})