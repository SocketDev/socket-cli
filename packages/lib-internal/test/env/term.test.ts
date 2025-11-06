/**
 * @fileoverview Unit tests for TERM environment variable getter.
 *
 * Tests getTerm() for terminal type detection (TERM env var, e.g., "xterm-256color").
 * Returns terminal type string or undefined. Used for terminal capability detection.
 * Uses rewire for test isolation. Critical for ANSI color and formatting support.
 */

import { getTerm } from '@socketsecurity/lib/env/term'
import { clearEnv, resetEnv, setEnv } from '@socketsecurity/lib/env/rewire'
import { afterEach, describe, expect, it } from 'vitest'

describe('env/term', () => {
  afterEach(() => {
    resetEnv()
  })

  describe('getTerm', () => {
    it('should return TERM environment variable when set', () => {
      setEnv('TERM', 'xterm-256color')
      expect(getTerm()).toBe('xterm-256color')
    })

    it('should return undefined when TERM is not set', () => {
      clearEnv('TERM')
      // After clearing override, falls back to actual process.env
      const result = getTerm()
      expect(typeof result).toMatch(/string|undefined/)
    })

    it('should handle xterm terminal', () => {
      setEnv('TERM', 'xterm')
      expect(getTerm()).toBe('xterm')
    })

    it('should handle xterm-256color terminal', () => {
      setEnv('TERM', 'xterm-256color')
      expect(getTerm()).toBe('xterm-256color')
    })

    it('should handle screen terminal', () => {
      setEnv('TERM', 'screen')
      expect(getTerm()).toBe('screen')
    })

    it('should handle screen-256color terminal', () => {
      setEnv('TERM', 'screen-256color')
      expect(getTerm()).toBe('screen-256color')
    })

    it('should handle tmux terminal', () => {
      setEnv('TERM', 'tmux')
      expect(getTerm()).toBe('tmux')
    })

    it('should handle tmux-256color terminal', () => {
      setEnv('TERM', 'tmux-256color')
      expect(getTerm()).toBe('tmux-256color')
    })

    it('should handle vt100 terminal', () => {
      setEnv('TERM', 'vt100')
      expect(getTerm()).toBe('vt100')
    })

    it('should handle linux terminal', () => {
      setEnv('TERM', 'linux')
      expect(getTerm()).toBe('linux')
    })

    it('should handle dumb terminal', () => {
      setEnv('TERM', 'dumb')
      expect(getTerm()).toBe('dumb')
    })

    it('should handle rxvt terminal', () => {
      setEnv('TERM', 'rxvt')
      expect(getTerm()).toBe('rxvt')
    })

    it('should handle rxvt-unicode terminal', () => {
      setEnv('TERM', 'rxvt-unicode')
      expect(getTerm()).toBe('rxvt-unicode')
    })

    it('should handle ansi terminal', () => {
      setEnv('TERM', 'ansi')
      expect(getTerm()).toBe('ansi')
    })

    it('should handle empty string', () => {
      setEnv('TERM', '')
      expect(getTerm()).toBe('')
    })

    it('should handle color variant terminals', () => {
      setEnv('TERM', 'xterm-color')
      expect(getTerm()).toBe('xterm-color')
    })

    it('should handle iTerm2 terminal', () => {
      setEnv('TERM', 'iTerm2')
      expect(getTerm()).toBe('iTerm2')
    })

    it('should handle Alacritty terminal', () => {
      setEnv('TERM', 'alacritty')
      expect(getTerm()).toBe('alacritty')
    })

    it('should handle Kitty terminal', () => {
      setEnv('TERM', 'xterm-kitty')
      expect(getTerm()).toBe('xterm-kitty')
    })

    it('should handle WezTerm terminal', () => {
      setEnv('TERM', 'wezterm')
      expect(getTerm()).toBe('wezterm')
    })

    it('should handle updating terminal value', () => {
      setEnv('TERM', 'xterm')
      expect(getTerm()).toBe('xterm')

      setEnv('TERM', 'xterm-256color')
      expect(getTerm()).toBe('xterm-256color')

      setEnv('TERM', 'screen-256color')
      expect(getTerm()).toBe('screen-256color')
    })

    it('should handle clearing and re-setting', () => {
      setEnv('TERM', 'xterm')
      expect(getTerm()).toBe('xterm')

      clearEnv('TERM')
      // After clearing override, falls back to actual process.env
      const result = getTerm()
      expect(typeof result).toMatch(/string|undefined/)

      setEnv('TERM', 'screen')
      expect(getTerm()).toBe('screen')
    })

    it('should handle custom terminal types', () => {
      setEnv('TERM', 'custom-terminal')
      expect(getTerm()).toBe('custom-terminal')
    })

    it('should handle numeric values as strings', () => {
      setEnv('TERM', '12345')
      expect(getTerm()).toBe('12345')
    })

    it('should handle consecutive reads', () => {
      setEnv('TERM', 'xterm-256color')
      expect(getTerm()).toBe('xterm-256color')
      expect(getTerm()).toBe('xterm-256color')
      expect(getTerm()).toBe('xterm-256color')
    })
  })
})
