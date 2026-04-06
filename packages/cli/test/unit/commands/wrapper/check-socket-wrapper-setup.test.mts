/**
 * @fileoverview Unit tests for checkSocketWrapperSetup.
 */

import fs from 'node:fs'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkSocketWrapperSetup } from '../../../../src/commands/wrapper/check-socket-wrapper-setup.mts'

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

describe('checkSocketWrapperSetup', () => {
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync')
  })

  afterEach(() => {
    readFileSyncSpy.mockRestore()
  })

  it('detects npm alias in file', () => {
    readFileSyncSpy.mockReturnValue('alias npm="socket npm"\nother content')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(true)
    expect(fs.readFileSync).toHaveBeenCalledWith('/home/user/.bashrc', 'utf8')
  })

  it('detects npx alias in file', () => {
    readFileSyncSpy.mockReturnValue('alias npx="socket npx"\nother content')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(true)
  })

  it('detects both aliases in file', () => {
    readFileSyncSpy.mockReturnValue(
      'alias npm="socket npm"\nalias npx="socket npx"\nother content',
    )

    const result = checkSocketWrapperSetup('/home/user/.zshrc')

    expect(result).toBe(true)
  })

  it('returns false when no aliases found', () => {
    readFileSyncSpy.mockReturnValue('some other content\nno aliases here')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('returns false for empty file', () => {
    readFileSyncSpy.mockReturnValue('')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('logs instructions when wrapper is set up', () => {
    readFileSyncSpy.mockReturnValue('alias npm="socket npm"')

    checkSocketWrapperSetup('/home/user/.bashrc')

    expect(mockLogger.log).toHaveBeenCalledWith(
      'The Socket npm/npx wrapper is set up in your bash profile (/home/user/.bashrc).',
    )
    expect(mockLogger.log).toHaveBeenCalledWith(
      '    source /home/user/.bashrc',
    )
  })

  it('ignores partial alias matches', () => {
    readFileSyncSpy.mockReturnValue(
      'alias npm="other-tool npm"\nalias npx="other-tool npx"',
    )

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('handles multiline file with aliases mixed in', () => {
    readFileSyncSpy.mockReturnValue(
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
    readFileSyncSpy.mockReturnValue('ALIAS NPM="SOCKET NPM"')

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })

  it('handles files with Windows line endings', () => {
    readFileSyncSpy.mockReturnValue(
      'line1\r\nalias npm="socket npm"\r\nalias npx="socket npx"\r\n',
    )

    const result = checkSocketWrapperSetup('/home/user/.bashrc')

    expect(result).toBe(false)
  })
})
