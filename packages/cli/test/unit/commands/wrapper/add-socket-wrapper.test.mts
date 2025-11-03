import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addSocketWrapper } from '../../../../src/src/add-socket-wrapper.mts'

// Mock the dependencies.
vi.mock('node:fs')

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

describe('addSocketWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('successfully adds wrapper aliases to file', async () => {
    await import('@socketsecurity/lib/logger')
    const mockAppendFile = vi.mocked(fs.appendFile) as any

    mockAppendFile.mockImplementation((_file, _content, callback) => {
      callback(null)
    })

    addSocketWrapper('/home/user/.bashrc')

    expect(fs.appendFile).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
      expect.any(Function),
    )
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining('The alias was added to /home/user/.bashrc'),
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      'This will only be active in new terminal sessions going forward.',
    )
    expect(mockLogger.log).toHaveBeenCalledWith('    source /home/user/.bashrc')
  })

  it('handles file write error', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile) as any
    const error = new Error('Permission denied')

    mockAppendFile.mockImplementation((_file, _content, callback) => {
      callback(error)
    })

    const _result = addSocketWrapper('/etc/protected-file')

    expect(fs.appendFile).toHaveBeenCalledWith(
      '/etc/protected-file',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
      expect.any(Function),
    )
  })

  it('adds correct aliases content', async () => {
    const mockAppendFile = vi.mocked(fs.appendFile) as any
    let capturedContent = ''

    mockAppendFile.mockImplementation((_file, content, callback) => {
      capturedContent = content
      callback(null)
    })

    addSocketWrapper('/home/user/.zshrc')

    expect(capturedContent).toBe(
      'alias npm="socket npm"\nalias npx="socket npx"\n',
    )
  })

  it('logs disable instructions', async () => {
    await import('@socketsecurity/lib/logger')
    const mockAppendFile = vi.mocked(fs.appendFile) as any

    mockAppendFile.mockImplementation((_file, _content, callback) => {
      callback(null)
    })

    addSocketWrapper('/home/user/.bashrc')

    expect(mockLogger.log).toHaveBeenCalledWith(
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
      mockAppendFile.mockImplementation((_file, _content, callback) => {
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
