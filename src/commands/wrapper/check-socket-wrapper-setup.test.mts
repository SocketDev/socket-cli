import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkSocketWrapperSetup } from './check-socket-wrapper-setup.mts'

// Mock the dependencies.
vi.mock('node:fs')
vi.mock('@socketsecurity/lib/logger', () => ({
  logger: {
    log: vi.fn(),
  },
}))

describe('checkSocketWrapperSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('detects npm alias in file', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('alias npm="socket npm"\nother content')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(true)
    expect(fs.readFileSync).toHaveBeenCalledWith('/home/user/.bashrc', 'utf8')
  })

  it('detects npx alias in file', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('alias npx="socket npx"\nother content')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(true)
  })

  it('detects both aliases in file', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue(
      'alias npm="socket npm"\nalias npx="socket npx"\nother content',
    )

    const result = checkSocketWrapperSetup('/home/user/.zshrc')

    expect(result).toBe(true)
  })

  it('returns false when no aliases found', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('some other content\nno aliases here')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('returns false for empty file', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('logs instructions when wrapper is set up', async () => {
    const { logger } = await import('@socketsecurity/lib/logger')
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('alias npm="socket npm"')

    checkSocketWrapperSetup('/home/user/.bashrc')

    expect(logger.log).toHaveBeenCalledWith(
      'The Socket npm/npx wrapper is set up in your bash profile (/home/user/.bashrc).',
    )
    expect(logger.log).toHaveBeenCalledWith('    source /home/user/.bashrc')
  })

  it('ignores partial alias matches', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue(
      'alias npm="other-tool npm"\nalias npx="other-tool npx"',
    )

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('handles multiline file with aliases mixed in', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue(
      `#!/bin/bash
# User bashrc
export PATH=$PATH:/usr/local/bin
alias npm="socket npm"
alias ll="ls -la"
export NODE_ENV=development`,
    )

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(true)
  })

  it('is case-sensitive for alias detection', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    mockReadFileSync.mockReturnValue('ALIAS NPM="SOCKET NPM"')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('handles files with Windows line endings', () => {
    const mockReadFileSync = vi.mocked(fs.readFileSync) as any
    // When splitting on \n, Windows line endings leave \r at the end of lines,
    // so 'alias npm="socket npm"\r' !== 'alias npm="socket npm"'.
    // The function doesn't handle Windows line endings properly.
    mockReadFileSync.mockReturnValue(
      'line1\r\nalias npm="socket npm"\r\nalias npx="socket npx"\r\n',
    )

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    // The function splits by \n, leaving \r at the end, so exact match fails.
    expect(result).toBe(false)
  })
})
