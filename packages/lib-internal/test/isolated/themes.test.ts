/**
 * @fileoverview Isolated tests for color theme system.
 *
 * Tests theme management system for CLI color schemes:
 * - THEMES constant with predefined themes (socket, claude, etc.)
 * - SOCKET_THEME default theme configuration
 * - createTheme(), extendTheme() theme builders
 * - setTheme(), getTheme() global theme management
 * - withTheme(), withThemeSync() scoped theme execution
 * - resolveColor() color name resolution
 * Used by Socket CLI for customizable terminal color output.
 */

import {
  SOCKET_THEME,
  THEMES,
  createTheme,
  extendTheme,
  getTheme,
  resolveColor,
  setTheme,
  withTheme,
  withThemeSync,
} from '@socketsecurity/lib/themes'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('themes', () => {
  // Reset theme to default before and after each test to ensure isolation
  beforeEach(() => {
    setTheme('socket')
  })

  afterEach(() => {
    setTheme('socket')
  })

  describe('THEMES', () => {
    it('should have all default themes', () => {
      expect(THEMES).toHaveProperty('socket')
      expect(THEMES).toHaveProperty('sunset')
      expect(THEMES).toHaveProperty('terracotta')
      expect(THEMES).toHaveProperty('lush')
      expect(THEMES).toHaveProperty('ultra')
    })

    it('should have valid theme structures', () => {
      for (const theme of Object.values(THEMES)) {
        expect(theme).toHaveProperty('name')
        expect(theme).toHaveProperty('displayName')
        expect(theme).toHaveProperty('colors')
        expect(theme.colors).toHaveProperty('primary')
        expect(theme.colors).toHaveProperty('success')
        expect(theme.colors).toHaveProperty('error')
      }
    })
  })

  describe('setTheme / getTheme', () => {
    it('should set and get theme', () => {
      setTheme('sunset')
      expect(getTheme().name).toBe('sunset')
    })

    it('should set theme by object', () => {
      setTheme(THEMES['terracotta'])
      expect(getTheme().name).toBe('terracotta')
    })

    it('should default to socket theme', () => {
      expect(getTheme().name).toBe('socket')
    })
  })

  describe('withTheme', () => {
    it('should apply theme for async operation', async () => {
      const result = await withTheme('sunset', async () => {
        expect(getTheme().name).toBe('sunset')
        return 42
      })

      expect(result).toBe(42)
      // Theme is automatically restored via AsyncLocalStorage
      expect(getTheme().name).toBe('socket') // Falls back to default
    })

    it('should restore theme even if operation throws', async () => {
      await expect(
        withTheme('sunset', async () => {
          throw new Error('test error')
        }),
      ).rejects.toThrow('test error')

      expect(getTheme().name).toBe('socket') // Falls back to default
    })

    it('should isolate themes in nested async contexts', async () => {
      await withTheme('sunset', async () => {
        expect(getTheme().name).toBe('sunset')

        await withTheme('ultra', async () => {
          expect(getTheme().name).toBe('ultra')
        })

        // Theme automatically restored by AsyncLocalStorage
        expect(getTheme().name).toBe('sunset')
      })
    })
  })

  describe('withThemeSync', () => {
    it('should apply theme for sync operation', () => {
      const result = withThemeSync('sunset', () => {
        expect(getTheme().name).toBe('sunset')
        return 42
      })

      expect(result).toBe(42)
      // Theme is automatically restored via AsyncLocalStorage
      expect(getTheme().name).toBe('socket') // Falls back to default
    })

    it('should restore theme even if operation throws', () => {
      expect(() => {
        withThemeSync('sunset', () => {
          throw new Error('test error')
        })
      }).toThrow('test error')

      expect(getTheme().name).toBe('socket') // Falls back to default
    })
  })

  describe('resolveColor', () => {
    it('should resolve primary color reference', () => {
      const resolved = resolveColor('primary', SOCKET_THEME.colors)
      expect(resolved).toEqual([140, 82, 255])
    })

    it('should resolve secondary color reference', () => {
      const resolved = resolveColor('secondary', THEMES.sunset.colors)
      expect(resolved).toEqual([200, 100, 180])
    })

    it('should resolve secondary to primary if not defined', () => {
      const resolved = resolveColor('secondary', SOCKET_THEME.colors)
      expect(resolved).toEqual([140, 82, 255])
    })

    it('should pass through named colors', () => {
      const resolved = resolveColor('red', SOCKET_THEME.colors)
      expect(resolved).toBe('red')
    })

    it('should pass through RGB colors', () => {
      const rgb = [255, 0, 0] as const
      const resolved = resolveColor(rgb, SOCKET_THEME.colors)
      expect(resolved).toEqual(rgb)
    })

    it('should handle inherit', () => {
      const resolved = resolveColor('inherit', SOCKET_THEME.colors)
      expect(resolved).toBe('inherit')
    })
  })

  describe('extendTheme', () => {
    it('should extend theme with new colors', () => {
      const extended = extendTheme(SOCKET_THEME, {
        colors: {
          primary: [255, 100, 200],
        },
      })

      expect(extended.colors.primary).toEqual([255, 100, 200])
      expect(extended.colors.success).toBe('greenBright') // Preserved
    })

    it('should extend theme with new name', () => {
      const extended = extendTheme(SOCKET_THEME, {
        name: 'my-theme',
        displayName: 'My Theme',
      })

      expect(extended.name).toBe('my-theme')
      expect(extended.displayName).toBe('My Theme')
    })
  })

  describe('createTheme', () => {
    it('should create new theme', () => {
      const theme = createTheme({
        name: 'test',
        displayName: 'Test Theme',
        colors: {
          primary: [255, 0, 0],
          success: 'green',
          error: 'red',
          warning: 'yellow',
          info: 'blue',
          step: 'cyan',
          text: 'white',
          textDim: 'gray',
          link: 'cyan',
          prompt: 'primary',
        },
      })

      expect(theme.name).toBe('test')
      expect(theme.displayName).toBe('Test Theme')
      expect(theme.colors.primary).toEqual([255, 0, 0])
    })
  })
})
