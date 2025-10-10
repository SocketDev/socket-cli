import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addSocketWrapper } from './add-socket-wrapper.mts'

// Mock the dependencies
vi.mock('node:fs')
vi.mock('@socketsecurity/registry/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  },
}))

describe('addSocketWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('successfully adds wrapper aliases to file', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockAppendFile = vi.mocked(fs.appendFile) as any

    mockAppendFile.mockImplementation((file, content, callback) => {
      callback(null)
    })

    addSocketWrapper('/home/user/.bashrc')

    expect(fs.appendFile).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
      expect.any(Function),
    )
    expect(logger.success).toHaveBeenCalledWith(
      expect.stringContaining('The alias was added to /home/user/.bashrc'),
    )
    expect(logger.info).toHaveBeenCalledWith(
      'This will only be active in new terminal sessions going forward.',
    )
    expect(logger.log).toHaveBeenCalledWith('    source /home/user/.bashrc')
  })

  it('handles file write error', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile) as any
    const error = new Error('Permission denied')

    mockAppendFile.mockImplementation((file, content, callback) => {
      callback(error)
    })

    const result = addSocketWrapper('/etc/protected-file')

    expect(fs.appendFile).toHaveBeenCalledWith(
      '/etc/protected-file',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
      expect.any(Function),
    )
  })

  it('adds correct aliases content', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile) as any
    let capturedContent = ''

    mockAppendFile.mockImplementation((file, content, callback) => {
      capturedContent = content
      callback(null)
    })

    addSocketWrapper('/home/user/.zshrc')

    expect(capturedContent).toBe(
      'alias npm="socket npm"\nalias npx="socket npx"\n',
    )
  })

  it('logs disable instructions', async () => {
    const { logger } = await import('@socketsecurity/registry/lib/logger')
    const mockAppendFile = vi.mocked(fs.appendFile) as any

    mockAppendFile.mockImplementation((file, content, callback) => {
      callback(null)
    })

    addSocketWrapper('/home/user/.bashrc')

    expect(logger.log).toHaveBeenCalledWith(
      '  If you want to disable it at any time, run `socket wrapper --disable`',
    )
  })

  it('handles different shell config files', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile) as any
    const shells = [
      '/home/user/.bashrc',
      '/home/user/.zshrc',
      '/home/user/.bash_profile',
      '/home/user/.profile',
    ]

    for (const shellFile of shells) {
      vi.clearAllMocks()
      mockAppendFile.mockImplementation((file, content, callback) => {
        callback(null)
      })

      addSocketWrapper(shellFile)

      expect(fs.appendFile).toHaveBeenCalledWith(
        shellFile,
        'alias npm="socket npm"\nalias npx="socket npx"\n',
        expect.any(Function),
      )
    }
  })
})
