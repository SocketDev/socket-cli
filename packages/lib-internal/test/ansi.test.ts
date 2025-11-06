/**
 * @fileoverview Unit tests for ANSI escape code utilities.
 *
 * Tests ANSI escape code constants and utilities:
 * - Constants: ANSI_BOLD, ANSI_DIM, ANSI_ITALIC, ANSI_UNDERLINE, ANSI_STRIKETHROUGH, ANSI_RESET
 * - stripAnsi() removes ANSI escape codes from strings
 * - ansiRegex() provides regex pattern for matching ANSI codes
 * - Terminal formatting and color code handling
 * Used by Socket logger and output utilities for terminal text styling.
 */

import {
  ANSI_BOLD,
  ANSI_DIM,
  ANSI_ITALIC,
  ANSI_RESET,
  ANSI_STRIKETHROUGH,
  ANSI_UNDERLINE,
  ansiRegex,
  stripAnsi,
} from '@socketsecurity/lib/ansi'
import { describe, expect, it } from 'vitest'

describe('ansi', () => {
  describe('ANSI constants', () => {
    it('should have correct ANSI reset code', () => {
      expect(ANSI_RESET).toBe('\x1b[0m')
    })

    it('should have correct ANSI bold code', () => {
      expect(ANSI_BOLD).toBe('\x1b[1m')
    })

    it('should have correct ANSI dim code', () => {
      expect(ANSI_DIM).toBe('\x1b[2m')
    })

    it('should have correct ANSI italic code', () => {
      expect(ANSI_ITALIC).toBe('\x1b[3m')
    })

    it('should have correct ANSI underline code', () => {
      expect(ANSI_UNDERLINE).toBe('\x1b[4m')
    })

    it('should have correct ANSI strikethrough code', () => {
      expect(ANSI_STRIKETHROUGH).toBe('\x1b[9m')
    })
  })

  describe('ansiRegex', () => {
    it('should create regex for ANSI codes', () => {
      const regex = ansiRegex()
      expect(regex).toBeInstanceOf(RegExp)
      expect(regex.global).toBe(true)
    })

    it('should create regex with onlyFirst option', () => {
      const regex = ansiRegex({ onlyFirst: true })
      expect(regex).toBeInstanceOf(RegExp)
      expect(regex.global).toBe(false)
    })

    it('should match ANSI reset code', () => {
      const regex = ansiRegex()
      const text = '\x1b[0mPlain text'
      expect(regex.test(text)).toBe(true)
    })

    it('should match ANSI color codes', () => {
      const regex = ansiRegex()
      const text = '\x1b[31mRed text\x1b[0m'
      expect(regex.test(text)).toBe(true)
    })

    it('should match multiple ANSI codes', () => {
      const regex = ansiRegex()
      const text = '\x1b[1m\x1b[31mBold red\x1b[0m'
      const matches = text.match(regex)
      expect(matches).not.toBeNull()
      expect(matches?.length).toBeGreaterThanOrEqual(2)
    })

    it('should match CSI sequences', () => {
      const regex = ansiRegex()
      const text = '\x1b[2J\x1b[H'
      expect(regex.test(text)).toBe(true)
    })

    it('should handle options parameter undefined', () => {
      const regex = ansiRegex(undefined)
      expect(regex).toBeInstanceOf(RegExp)
      expect(regex.global).toBe(true)
    })

    it('should handle options with onlyFirst false', () => {
      const regex = ansiRegex({ onlyFirst: false })
      expect(regex.global).toBe(true)
    })

    it('should create non-global regex when onlyFirst is true', () => {
      const regex = ansiRegex({ onlyFirst: true })
      const text = '\x1b[31mRed\x1b[0m'
      const match = text.match(regex)
      expect(match).not.toBeNull()
      expect(match?.[0]).toBe('\x1b[31m')
    })
  })

  describe('stripAnsi', () => {
    it('should strip ANSI codes from text', () => {
      const text = '\x1b[31mRed text\x1b[0m'
      expect(stripAnsi(text)).toBe('Red text')
    })

    it('should strip bold formatting', () => {
      const text = '\x1b[1mBold text\x1b[0m'
      expect(stripAnsi(text)).toBe('Bold text')
    })

    it('should strip multiple ANSI codes', () => {
      const text = '\x1b[1m\x1b[31mBold red\x1b[0m'
      expect(stripAnsi(text)).toBe('Bold red')
    })

    it('should return plain text unchanged', () => {
      const text = 'Plain text'
      expect(stripAnsi(text)).toBe('Plain text')
    })

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('')
    })

    it('should strip color codes', () => {
      const text = '\x1b[31mRed\x1b[32mGreen\x1b[34mBlue\x1b[0m'
      expect(stripAnsi(text)).toBe('RedGreenBlue')
    })

    it('should strip underline and italic', () => {
      const text = '\x1b[3m\x1b[4mUnderlined Italic\x1b[0m'
      expect(stripAnsi(text)).toBe('Underlined Italic')
    })

    it('should strip background colors', () => {
      const text = '\x1b[41mRed background\x1b[0m'
      expect(stripAnsi(text)).toBe('Red background')
    })

    it('should strip 256 color codes', () => {
      const text = '\x1b[38;5;196mBright red\x1b[0m'
      expect(stripAnsi(text)).toBe('Bright red')
    })

    it('should strip RGB color codes', () => {
      const text = '\x1b[38;2;255;0;0mRGB red\x1b[0m'
      expect(stripAnsi(text)).toBe('RGB red')
    })

    it('should handle text with only ANSI codes', () => {
      const text = '\x1b[31m\x1b[1m\x1b[0m'
      expect(stripAnsi(text)).toBe('')
    })

    it('should handle mixed content', () => {
      const text = 'Normal \x1b[1mbold\x1b[0m normal \x1b[31mred\x1b[0m end'
      expect(stripAnsi(text)).toBe('Normal bold normal red end')
    })

    it('should handle newlines and special chars', () => {
      const text = '\x1b[31mLine 1\nLine 2\x1b[0m'
      expect(stripAnsi(text)).toBe('Line 1\nLine 2')
    })

    it('should handle unicode characters', () => {
      const text = '\x1b[31m你好世界\x1b[0m'
      expect(stripAnsi(text)).toBe('你好世界')
    })

    it('should handle emojis', () => {
      const text = '\x1b[32m✓\x1b[0m Success'
      expect(stripAnsi(text)).toBe('✓ Success')
    })
  })

  describe('ANSI constant usage', () => {
    it('should format text with bold', () => {
      const formatted = `${ANSI_BOLD}Bold text${ANSI_RESET}`
      expect(formatted).toBe('\x1b[1mBold text\x1b[0m')
      expect(stripAnsi(formatted)).toBe('Bold text')
    })

    it('should format text with italic', () => {
      const formatted = `${ANSI_ITALIC}Italic text${ANSI_RESET}`
      expect(formatted).toBe('\x1b[3mItalic text\x1b[0m')
      expect(stripAnsi(formatted)).toBe('Italic text')
    })

    it('should format text with underline', () => {
      const formatted = `${ANSI_UNDERLINE}Underlined text${ANSI_RESET}`
      expect(formatted).toBe('\x1b[4mUnderlined text\x1b[0m')
      expect(stripAnsi(formatted)).toBe('Underlined text')
    })

    it('should format text with dim', () => {
      const formatted = `${ANSI_DIM}Dim text${ANSI_RESET}`
      expect(formatted).toBe('\x1b[2mDim text\x1b[0m')
      expect(stripAnsi(formatted)).toBe('Dim text')
    })

    it('should format text with strikethrough', () => {
      const formatted = `${ANSI_STRIKETHROUGH}Struck text${ANSI_RESET}`
      expect(formatted).toBe('\x1b[9mStruck text\x1b[0m')
      expect(stripAnsi(formatted)).toBe('Struck text')
    })

    it('should combine multiple formats', () => {
      const formatted = `${ANSI_BOLD}${ANSI_ITALIC}Bold Italic${ANSI_RESET}`
      expect(stripAnsi(formatted)).toBe('Bold Italic')
    })
  })

  describe('edge cases', () => {
    it('should handle malformed ANSI codes', () => {
      const text = '\x1bIncomplete'
      expect(stripAnsi(text)).toBe('\x1bIncomplete')
    })

    it('should handle very long strings', () => {
      const longText = 'a'.repeat(10_000)
      const formatted = `\x1b[31m${longText}\x1b[0m`
      expect(stripAnsi(formatted)).toBe(longText)
    })

    it('should handle nested ANSI codes', () => {
      const text = '\x1b[31m\x1b[1mNested\x1b[0m\x1b[0m'
      expect(stripAnsi(text)).toBe('Nested')
    })

    it('should handle repeated reset codes', () => {
      const text = '\x1b[31mRed\x1b[0m\x1b[0m\x1b[0m'
      expect(stripAnsi(text)).toBe('Red')
    })
  })
})
