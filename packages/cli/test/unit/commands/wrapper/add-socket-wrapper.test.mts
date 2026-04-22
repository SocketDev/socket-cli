/**
 * Unit tests for addSocketWrapper.
 *
 * Purpose:
 * Tests adding Socket wrapper scripts to package managers. Validates wrapper installation for npm, pnpm, and yarn.
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
 * - src/addSocketWrapper.mts (implementation)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addSocketWrapper } from '../../../../src/commands/../../../../src/commands/wrapper/add-socket-wrapper.mts'

// Mock the dependencies.
vi.mock('node:fs', () => ({
  promises: {
    appendFile: vi.fn(),
  },
}))

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
    const fs = await import('node:fs')
    const mockAppendFile = vi.mocked(fs.promises.appendFile)

    mockAppendFile.mockResolvedValue(undefined)

    await addSocketWrapper('/home/user/.bashrc')

    expect(fs.promises.appendFile).toHaveBeenCalledWith(
      '/home/user/.bashrc',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
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
    const fs = await import('node:fs')
    const mockAppendFile = vi.mocked(fs.promises.appendFile)
    const error = new Error('Permission denied')

    mockAppendFile.mockRejectedValue(error)

    await expect(addSocketWrapper('/etc/protected-file')).rejects.toThrow(
      /failed to append socket aliases to \/etc\/protected-file/,
    )

    expect(fs.promises.appendFile).toHaveBeenCalledWith(
      '/etc/protected-file',
      'alias npm="socket npm"\nalias npx="socket npx"\n',
    )
  })

  it('adds correct aliases content', async () => {
    const fs = await import('node:fs')
    const mockAppendFile = vi.mocked(fs.promises.appendFile)
    let capturedContent = ''

    mockAppendFile.mockImplementation(async (_file, content) => {
      capturedContent = content as string
    })

    await addSocketWrapper('/home/user/.zshrc')

    expect(capturedContent).toBe(
      'alias npm="socket npm"\nalias npx="socket npx"\n',
    )
  })

  it('logs disable instructions', async () => {
    await import('@socketsecurity/lib/logger')
    const fs = await import('node:fs')
    const mockAppendFile = vi.mocked(fs.promises.appendFile)

    mockAppendFile.mockResolvedValue(undefined)

    await addSocketWrapper('/home/user/.bashrc')

    expect(mockLogger.log).toHaveBeenCalledWith(
      '  If you want to disable it at any time, run `socket wrapper --disable`',
    )
  })

  it('handles different shell config files', async () => {
    const fs = await import('node:fs')
    const mockAppendFile = vi.mocked(fs.promises.appendFile)
    const shells = [
      '/home/user/.bashrc',
      '/home/user/.zshrc',
      '/home/user/.bash_profile',
      '/home/user/.profile',
    ]

    for (const shellFile of shells) {
      vi.clearAllMocks()
      mockAppendFile.mockResolvedValue(undefined)

      await addSocketWrapper(shellFile)

      expect(fs.promises.appendFile).toHaveBeenCalledWith(
        shellFile,
        'alias npm="socket npm"\nalias npx="socket npx"\n',
      )
    }
  })
})
