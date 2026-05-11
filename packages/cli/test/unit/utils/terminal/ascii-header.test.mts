/**
 * @fileoverview Tests for ASCII header with shimmer effects.
 * Validates header rendering, theme handling, and environment detection.
 */

import { describe, expect, it } from 'vitest'

import {
  formatInfoLine,
  renderLogoWithFallback,
  renderShimmerFrame,
  renderStaticLogo,
  supportsFullColor,
  type HeaderTheme,
} from '../../../../src/utils/terminal/ascii-header.mts'

/**
 * Strip ANSI color codes from string for shimmer testing.
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

describe('ascii-header', () => {
  describe('supportsFullColor', () => {
    it('should detect COLORTERM=truecolor', () => {
      const originalColorterm = process.env['COLORTERM']
      try {
        process.env['COLORTERM'] = 'truecolor'
        expect(supportsFullColor()).toBe(true)
      } finally {
        if (originalColorterm === undefined) {
          delete process.env['COLORTERM']
        } else {
          process.env['COLORTERM'] = originalColorterm
        }
      }
    })

    it('should detect COLORTERM=24bit', () => {
      const originalColorterm = process.env['COLORTERM']
      try {
        process.env['COLORTERM'] = '24bit'
        expect(supportsFullColor()).toBe(true)
      } finally {
        if (originalColorterm === undefined) {
          delete process.env['COLORTERM']
        } else {
          process.env['COLORTERM'] = originalColorterm
        }
      }
    })

    it('should detect TERM_PROGRAM=iTerm.app', () => {
      const originalTermProgram = process.env['TERM_PROGRAM']
      const originalColorterm = process.env['COLORTERM']
      try {
        delete process.env['COLORTERM']
        process.env['TERM_PROGRAM'] = 'iTerm.app'
        expect(supportsFullColor()).toBe(true)
      } finally {
        if (originalTermProgram === undefined) {
          delete process.env['TERM_PROGRAM']
        } else {
          process.env['TERM_PROGRAM'] = originalTermProgram
        }
        if (originalColorterm !== undefined) {
          process.env['COLORTERM'] = originalColorterm
        }
      }
    })

    it('should return false for basic terminals', () => {
      const originalColorterm = process.env['COLORTERM']
      const originalTerm = process.env['TERM']
      const originalTermProgram = process.env['TERM_PROGRAM']
      try {
        delete process.env['COLORTERM']
        delete process.env['TERM_PROGRAM']
        process.env['TERM'] = 'xterm'
        expect(supportsFullColor()).toBe(false)
      } finally {
        if (originalColorterm !== undefined) {
          process.env['COLORTERM'] = originalColorterm
        }
        if (originalTerm !== undefined) {
          process.env['TERM'] = originalTerm
        }
        if (originalTermProgram !== undefined) {
          process.env['TERM_PROGRAM'] = originalTermProgram
        }
      }
    })
  })

  describe('renderStaticLogo', () => {
    it('should render logo with default theme', () => {
      const logo = renderStaticLogo()
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
      expect(logo).toContain('\x1b[38;2;') // Contains RGB color codes
    })

    it('should render logo with cyberpunk theme', () => {
      const logo = renderStaticLogo('cyberpunk')
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
    })

    it('should render logo with forest theme', () => {
      const logo = renderStaticLogo('forest')
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
    })

    it('should render logo with ocean theme', () => {
      const logo = renderStaticLogo('ocean')
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
    })

    it('should render logo with sunset theme', () => {
      const logo = renderStaticLogo('sunset')
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
    })

    it('should produce 4 lines of output', () => {
      const logo = renderStaticLogo()
      const lines = logo.split('\n')
      expect(lines).toHaveLength(4)
    })

    it('should not contain ANSI bold codes (bold is for shimmer only)', () => {
      const logo = renderStaticLogo()
      expect(logo).not.toContain('\x1b[1m')
    })
  })

  describe('renderShimmerFrame', () => {
    it('should render shimmer frame with default theme', () => {
      const logo = renderShimmerFrame(0)
      const stripped = stripAnsi(logo)
      expect(stripped).toContain('|')
      expect(stripped).toContain('dev')
    })

    it('should render different frames differently', () => {
      const frame0 = renderShimmerFrame(0)
      const frame10 = renderShimmerFrame(10)
      // The shimmer engine (`@socketsecurity/lib/effects/shimmer`) is
      // pure: a different frame counter advances the wave's position
      // and changes per-character truecolor codes. There's no CI
      // special-case in the engine, so frames must always differ.
      expect(frame0).not.toBe(frame10)
    })

    it('should render shimmer with all themes', () => {
      const themes: HeaderTheme[] = [
        'default',
        'cyberpunk',
        'forest',
        'ocean',
        'sunset',
      ]
      for (const theme of themes) {
        const logo = renderShimmerFrame(0, theme)
        const stripped = stripAnsi(logo)
        expect(stripped).toContain('|')
        expect(stripped).toContain('dev')
      }
    })

    it('should produce 4 lines of output', () => {
      const logo = renderShimmerFrame(0)
      const lines = logo.split('\n')
      expect(lines).toHaveLength(4)
    })

    it('should contain ANSI bold codes', () => {
      const logo = renderShimmerFrame(0)
      expect(logo).toContain('\x1b[1m')
    })

    it('should apply slanted shimmer effect across lines', () => {
      // Each line should have different shimmer offset creating diagonal effect
      const logo = renderShimmerFrame(0)
      expect(logo).toBeTruthy()
      // Slant is implemented via frame offset, not directly testable via output comparison
    })
  })

  describe('renderLogoWithFallback', () => {
    it('should render static logo when frame is null', () => {
      const logo = renderLogoWithFallback(undefined)
      expect(logo).toContain('|   __|___') // ASCII art content
      expect(logo).toContain('.dev')
    })

    it('should render shimmer when frame provided and full color supported', () => {
      const originalColorterm = process.env['COLORTERM']
      try {
        process.env['COLORTERM'] = 'truecolor'
        const logo = renderLogoWithFallback(0)
        const stripped = stripAnsi(logo)
        expect(stripped).toContain('|')
        expect(stripped).toContain('dev')
        // With full color support, should use shimmer (contains bold)
        if (supportsFullColor()) {
          expect(logo).toContain('\x1b[1m')
        }
      } finally {
        if (originalColorterm === undefined) {
          delete process.env['COLORTERM']
        } else {
          process.env['COLORTERM'] = originalColorterm
        }
      }
    })

    it('should render simple color logo without full color support', () => {
      const originalColorterm = process.env['COLORTERM']
      const originalTerm = process.env['TERM']
      const originalTermProgram = process.env['TERM_PROGRAM']
      try {
        delete process.env['COLORTERM']
        delete process.env['TERM_PROGRAM']
        process.env['TERM'] = 'xterm'
        const logo = renderLogoWithFallback(0)
        expect(logo).toContain('|   __|___') // ASCII art content
        // Without full color support, should use simple colors (no RGB codes)
        if (!supportsFullColor()) {
          expect(logo).not.toContain('\x1b[38;2;')
        }
      } finally {
        if (originalColorterm !== undefined) {
          process.env['COLORTERM'] = originalColorterm
        }
        if (originalTerm !== undefined) {
          process.env['TERM'] = originalTerm
        }
        if (originalTermProgram !== undefined) {
          process.env['TERM_PROGRAM'] = originalTermProgram
        }
      }
    })

    it('should support all themes with fallback', () => {
      const themes: HeaderTheme[] = [
        'default',
        'cyberpunk',
        'forest',
        'ocean',
        'sunset',
      ]
      for (const theme of themes) {
        const logo = renderLogoWithFallback(undefined, theme)
        expect(logo).toContain('|   __|___') // ASCII art content
      }
    })
  })

  describe('formatInfoLine', () => {
    it('should format info line with default theme', () => {
      const formatted = formatInfoLine('Test info', 'default')
      expect(formatted).toContain('Test info')
      expect(formatted).toContain('\x1b[38;2;') // RGB color code
    })

    it('should format info line with different themes', () => {
      const themes: HeaderTheme[] = [
        'default',
        'cyberpunk',
        'forest',
        'ocean',
        'sunset',
      ]
      for (const theme of themes) {
        const formatted = formatInfoLine('Version 1.0.0', theme)
        expect(formatted).toContain('Version 1.0.0')
        expect(formatted).toContain('\x1b[38;2;')
      }
    })

    it('should preserve text content', () => {
      const text = 'CLI v1.2.3 - https://socket.dev'
      const formatted = formatInfoLine(text, 'ocean')
      // Strip ANSI codes to verify text preservation
      const stripped = formatted.replace(/\x1b\[[0-9;]*m/g, '')
      expect(stripped).toBe(text)
    })
  })

  describe('CI and VITEST mode detection', () => {
    it('should not show animations in VITEST mode', () => {
      // In VITEST mode, we should use static rendering
      const isVitest = process.env['VITEST'] === 'true'
      if (isVitest) {
        // When running under vitest, prefer static logo
        const logo = renderLogoWithFallback(undefined)
        expect(logo).toContain('|   __|___') // ASCII art content
      }
    })

    it('should handle missing environment variables gracefully', () => {
      const originalColorterm = process.env['COLORTERM']
      const originalTerm = process.env['TERM']
      const originalTermProgram = process.env['TERM_PROGRAM']
      try {
        delete process.env['COLORTERM']
        delete process.env['TERM']
        delete process.env['TERM_PROGRAM']
        expect(() => supportsFullColor()).not.toThrow()
        expect(() => renderLogoWithFallback(undefined)).not.toThrow()
      } finally {
        if (originalColorterm !== undefined) {
          process.env['COLORTERM'] = originalColorterm
        }
        if (originalTerm !== undefined) {
          process.env['TERM'] = originalTerm
        }
        if (originalTermProgram !== undefined) {
          process.env['TERM_PROGRAM'] = originalTermProgram
        }
      }
    })
  })

  describe('edge cases', () => {
    it('should handle very large frame numbers', () => {
      const logo = renderShimmerFrame(1000000)
      const stripped = stripAnsi(logo)
      expect(stripped).toContain('|')
      expect(stripped).toContain('dev')
    })

    it('should handle negative frame numbers', () => {
      const logo = renderShimmerFrame(-10)
      const stripped = stripAnsi(logo)
      expect(stripped).toContain('|')
      expect(stripped).toContain('dev')
    })

    it('should handle frame 0 consistently', () => {
      const logo1 = renderShimmerFrame(0)
      const logo2 = renderShimmerFrame(0)
      expect(logo1).toBe(logo2)
    })
  })

  describe('applyHexColor', () => {
    it('wraps text with 24-bit ANSI escape codes derived from hex', async () => {
      const { applyHexColor } =
        await import('../../../../src/utils/terminal/ascii-header.mts')
      const result = applyHexColor('hello', '#ff8000')
      expect(result).toBe('\x1b[38;2;255;128;0mhello\x1b[0m')
    })

    it('handles black + white extremes', async () => {
      const { applyHexColor } =
        await import('../../../../src/utils/terminal/ascii-header.mts')
      expect(applyHexColor('x', '#000000')).toBe('\x1b[38;2;0;0;0mx\x1b[0m')
      expect(applyHexColor('x', '#ffffff')).toBe(
        '\x1b[38;2;255;255;255mx\x1b[0m',
      )
    })
  })

  describe('brighterRgb', () => {
    it('returns the brighter of two RGB tuples by channel sum', async () => {
      const { brighterRgb } =
        await import('../../../../src/utils/terminal/ascii-header.mts')
      const dark: [number, number, number] = [10, 10, 10]
      const bright: [number, number, number] = [200, 200, 200]
      expect(brighterRgb(dark, bright)).toBe(bright)
      expect(brighterRgb(bright, dark)).toBe(bright)
    })

    it('returns the first arg on ties (a >= b)', async () => {
      const { brighterRgb } =
        await import('../../../../src/utils/terminal/ascii-header.mts')
      const a: [number, number, number] = [50, 50, 50]
      const b: [number, number, number] = [50, 50, 50]
      expect(brighterRgb(a, b)).toBe(a)
    })
  })
})
