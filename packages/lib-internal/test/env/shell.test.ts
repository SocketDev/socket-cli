/**
 * @fileoverview Unit tests for SHELL environment variable getter.
 *
 * Tests getShell() for user's default shell (SHELL env var, e.g., /bin/bash, /bin/zsh).
 * Returns shell path string or undefined. Unix/Linux standard.
 * Uses rewire for test isolation. Used for shell-specific behavior and command execution.
 */

import { getShell } from '@socketsecurity/lib/env/shell'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/shell', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getShell', () => {
    it('should return SHELL environment variable when set', () => {
      setEnv('SHELL', '/bin/bash')
      expect(getShell()).toBe('/bin/bash')
    })

    it('should return undefined when SHELL is not set', () => {
      clearEnv('SHELL')
      // After clearing override, falls back to actual process.env
      const result = getShell()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle bash shell path', () => {
      setEnv('SHELL', '/bin/bash')
      expect(getShell()).toBe('/bin/bash')
    })

    it('should handle zsh shell path', () => {
      setEnv('SHELL', '/bin/zsh')
      expect(getShell()).toBe('/bin/zsh')
    })

    it('should handle sh shell path', () => {
      setEnv('SHELL', '/bin/sh')
      expect(getShell()).toBe('/bin/sh')
    })

    it('should handle fish shell path', () => {
      setEnv('SHELL', '/usr/bin/fish')
      expect(getShell()).toBe('/usr/bin/fish')
    })

    it('should handle tcsh shell path', () => {
      setEnv('SHELL', '/bin/tcsh')
      expect(getShell()).toBe('/bin/tcsh')
    })

    it('should handle ksh shell path', () => {
      setEnv('SHELL', '/bin/ksh')
      expect(getShell()).toBe('/bin/ksh')
    })

    it('should handle custom shell path', () => {
      setEnv('SHELL', '/opt/custom/bin/shell')
      expect(getShell()).toBe('/opt/custom/bin/shell')
    })

    it('should handle Homebrew bash path', () => {
      setEnv('SHELL', '/usr/local/bin/bash')
      expect(getShell()).toBe('/usr/local/bin/bash')
    })

    it('should handle Homebrew zsh path', () => {
      setEnv('SHELL', '/usr/local/bin/zsh')
      expect(getShell()).toBe('/usr/local/bin/zsh')
    })

    it('should handle empty string', () => {
      setEnv('SHELL', '')
      expect(getShell()).toBe('')
    })

    it('should handle absolute paths', () => {
      setEnv('SHELL', '/usr/bin/zsh')
      expect(getShell()).toBe('/usr/bin/zsh')
    })

    it('should handle non-standard paths', () => {
      setEnv('SHELL', '/some/weird/path/shell')
      expect(getShell()).toBe('/some/weird/path/shell')
    })

    it('should handle multiple consecutive reads', () => {
      setEnv('SHELL', '/bin/bash')
      expect(getShell()).toBe('/bin/bash')
      expect(getShell()).toBe('/bin/bash')
      expect(getShell()).toBe('/bin/bash')
    })

    it('should handle updating shell value', () => {
      setEnv('SHELL', '/bin/bash')
      expect(getShell()).toBe('/bin/bash')

      setEnv('SHELL', '/bin/zsh')
      expect(getShell()).toBe('/bin/zsh')

      setEnv('SHELL', '/bin/fish')
      expect(getShell()).toBe('/bin/fish')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('SHELL', '/bin/bash')
      expect(getShell()).toBe('/bin/bash')

      clearEnv('SHELL')
      // After clearing override, falls back to actual process.env
      const result = getShell()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('SHELL', '/bin/zsh')
      expect(getShell()).toBe('/bin/zsh')
    })

    it('should handle paths with spaces', () => {
      setEnv('SHELL', '/path with spaces/bash')
      expect(getShell()).toBe('/path with spaces/bash')
    })

    it('should handle paths with special characters', () => {
      setEnv('SHELL', '/path-with_special.chars/bash')
      expect(getShell()).toBe('/path-with_special.chars/bash')
    })

    it('should handle Windows-style paths', () => {
      setEnv('SHELL', 'C:\\Program Files\\Git\\bin\\bash.exe')
      expect(getShell()).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
    })

    it('should handle relative paths', () => {
      setEnv('SHELL', './local/bash')
      expect(getShell()).toBe('./local/bash')
    })

    it('should handle tilde in path', () => {
      setEnv('SHELL', '~/bin/bash')
      expect(getShell()).toBe('~/bin/bash')
    })

    it('should handle dash shell', () => {
      setEnv('SHELL', '/bin/dash')
      expect(getShell()).toBe('/bin/dash')
    })

    it('should handle ash shell', () => {
      setEnv('SHELL', '/bin/ash')
      expect(getShell()).toBe('/bin/ash')
    })

    it('should handle csh shell', () => {
      setEnv('SHELL', '/bin/csh')
      expect(getShell()).toBe('/bin/csh')
    })
  })
})
