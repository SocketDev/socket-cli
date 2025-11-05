/**
 * @fileoverview Unit tests for theme utility functions.
 *
 * Tests color resolution utilities for Socket's theme system:
 * - resolveColor() resolves semantic color keywords (primary, secondary) to actual colors
 * - Handles color values as strings ('blue', 'red') or RGB tuples ([255, 0, 0])
 * - Fallback behavior: 'secondary' falls back to 'primary' when undefined
 * - 'inherit' keyword passes through unchanged
 * - Direct color values (non-keywords) pass through unchanged
 * Enables consistent theming across Socket CLI tools with semantic color names.
 */

import { resolveColor } from '@socketsecurity/lib/themes/utils'
import { describe, expect, it } from 'vitest'

describe('themes/utils', () => {
  describe('resolveColor', () => {
    it('should resolve primary keyword', () => {
      const result = resolveColor('primary', {
        primary: 'blue' as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toBe('blue')
    })

    it('should resolve secondary keyword with fallback', () => {
      const result = resolveColor('secondary', {
        primary: 'blue' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      // Falls back to primary when secondary is undefined
      expect(result).toBe('blue')
    })

    it('should resolve secondary when defined', () => {
      const result = resolveColor('secondary', {
        primary: 'blue' as const,
        secondary: 'magenta' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toBe('magenta')
    })

    it('should resolve inherit keyword', () => {
      const result = resolveColor('inherit', {
        primary: 'blue' as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toBe('inherit')
    })

    it('should pass through color values', () => {
      const result = resolveColor('red', {
        primary: 'blue' as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toBe('red')
    })

    it('should pass through RGB tuples', () => {
      const result = resolveColor([255, 100, 50], {
        primary: 'blue' as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toEqual([255, 100, 50])
    })

    it('should resolve primary as RGB tuple', () => {
      const result = resolveColor('primary', {
        primary: [100, 150, 200] as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toEqual([100, 150, 200])
    })
  })

  describe('color resolution edge cases', () => {
    it('should handle mixed color value types', () => {
      const colors = {
        primary: 'blue' as const,
        secondary: [100, 150, 200] as const,
        success: 'green' as const,
        error: [255, 0, 0] as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      }
      expect(resolveColor('primary', colors)).toBe('blue')
      expect(resolveColor('secondary', colors)).toEqual([100, 150, 200])
    })

    it('should handle arbitrary color names', () => {
      const result = resolveColor('yellowBright' as any, {
        primary: 'blue' as const,
        secondary: 'green' as const,
        success: 'green' as const,
        error: 'red' as const,
        warning: 'yellow' as const,
        info: 'cyan' as const,
        step: 'cyan' as const,
        text: 'white' as const,
        textDim: 'gray' as const,
        link: 'blue' as const,
        prompt: 'cyan' as const,
      })
      expect(result).toBe('yellowBright')
    })
  })
})
