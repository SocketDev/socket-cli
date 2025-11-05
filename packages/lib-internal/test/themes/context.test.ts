/**
 * @fileoverview Unit tests for theme context management.
 *
 * Tests AsyncLocalStorage-based theme context management for scoped theming:
 * - getTheme() retrieves the current theme from context
 * - setTheme() sets the global theme (name string or Theme object)
 * - withTheme() runs async functions with a scoped theme, restoring previous on completion
 * - withThemeSync() provides synchronous scoped theme execution
 * - onThemeChange() registers listeners for theme changes with cleanup
 * - Handles nested theme scopes, rapid theme switches, and listener management
 * Enables theme isolation across concurrent operations in Socket CLI tools.
 */

import {
  getTheme,
  setTheme,
  withTheme,
  withThemeSync,
  onThemeChange,
} from '@socketsecurity/lib/themes/context'
import { describe, expect, it, beforeEach } from 'vitest'

describe('themes/context', () => {
  describe('getTheme', () => {
    it('should return a theme object', () => {
      const theme = getTheme()
      expect(theme).toBeDefined()
      expect(theme).toHaveProperty('name')
      expect(theme).toHaveProperty('colors')
    })

    it('should return theme with required properties', () => {
      const theme = getTheme()
      expect(theme.colors).toBeDefined()
      expect(theme.colors.primary).toBeDefined()
      expect(theme.colors.success).toBeDefined()
      expect(theme.colors.error).toBeDefined()
    })
  })

  describe('setTheme', () => {
    beforeEach(() => {
      // Reset to default theme
      setTheme('socket')
    })

    it('should accept theme name', () => {
      setTheme('socket')
      const theme = getTheme()
      expect(theme.name).toBe('socket')
    })

    it('should accept theme object', () => {
      const customTheme = {
        name: 'custom',
        displayName: 'Custom',
        colors: {
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
        },
      }
      setTheme(customTheme)
      const theme = getTheme()
      expect(theme.name).toBe('custom')
    })

    it('should change active theme', () => {
      setTheme('socket')
      expect(getTheme().name).toBe('socket')

      setTheme('sunset')
      expect(getTheme().name).toBe('sunset')
    })
  })

  describe('withTheme', () => {
    beforeEach(() => {
      setTheme('socket')
    })

    it('should run async function with scoped theme', async () => {
      let capturedTheme: string | undefined

      await withTheme('sunset', async () => {
        capturedTheme = getTheme().name
      })

      expect(capturedTheme).toBe('sunset')
    })

    it('should restore previous theme after async completion', async () => {
      setTheme('socket')

      await withTheme('sunset', async () => {
        expect(getTheme().name).toBe('sunset')
      })

      expect(getTheme().name).toBe('socket')
    })

    it('should return the async function result', async () => {
      const result = await withTheme('socket', async () => {
        return 42
      })

      expect(result).toBe(42)
    })

    it('should work with nested async calls', async () => {
      setTheme('socket')

      await withTheme('sunset', async () => {
        expect(getTheme().name).toBe('sunset')

        await withTheme('socket', async () => {
          expect(getTheme().name).toBe('socket')
        })

        expect(getTheme().name).toBe('sunset')
      })

      expect(getTheme().name).toBe('socket')
    })

    it('should handle promises', async () => {
      const result = await withTheme('socket', async () => {
        return await Promise.resolve('test-value')
      })

      expect(result).toBe('test-value')
    })

    it('should accept theme object', async () => {
      const customTheme = {
        name: 'custom',
        displayName: 'Custom',
        colors: {
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
        },
      }

      await withTheme(customTheme, async () => {
        expect(getTheme().name).toBe('custom')
      })
    })
  })

  describe('withThemeSync', () => {
    beforeEach(() => {
      setTheme('socket')
    })

    it('should run sync function with scoped theme', () => {
      let capturedTheme: string | undefined

      withThemeSync('sunset', () => {
        capturedTheme = getTheme().name
      })

      expect(capturedTheme).toBe('sunset')
    })

    it('should restore previous theme after sync completion', () => {
      setTheme('socket')

      withThemeSync('sunset', () => {
        expect(getTheme().name).toBe('sunset')
      })

      expect(getTheme().name).toBe('socket')
    })

    it('should return the sync function result', () => {
      const result = withThemeSync('socket', () => {
        return 'sync-result'
      })

      expect(result).toBe('sync-result')
    })

    it('should work with nested sync calls', () => {
      setTheme('socket')

      withThemeSync('sunset', () => {
        expect(getTheme().name).toBe('sunset')

        withThemeSync('socket', () => {
          expect(getTheme().name).toBe('socket')
        })

        expect(getTheme().name).toBe('sunset')
      })

      expect(getTheme().name).toBe('socket')
    })

    it('should accept theme object', () => {
      const customTheme = {
        name: 'custom-sync',
        displayName: 'Custom Sync',
        colors: {
          primary: 'red' as const,
          secondary: 'blue' as const,
          success: 'green' as const,
          error: 'red' as const,
          warning: 'yellow' as const,
          info: 'cyan' as const,
          step: 'cyan' as const,
          text: 'white' as const,
          textDim: 'gray' as const,
          link: 'blue' as const,
          prompt: 'cyan' as const,
        },
      }

      withThemeSync(customTheme, () => {
        expect(getTheme().name).toBe('custom-sync')
      })
    })
  })

  describe('onThemeChange', () => {
    const unsubscribers: Array<() => void> = []

    beforeEach(() => {
      setTheme('socket')
      // Clean up any leftover listeners
      unsubscribers.forEach(u => u())
      unsubscribers.length = 0
    })

    it('should register theme change listener', () => {
      let callCount = 0
      const unsubscribe = onThemeChange(() => {
        callCount++
      })
      unsubscribers.push(unsubscribe)

      setTheme('sunset')
      expect(callCount).toBeGreaterThanOrEqual(1)

      unsubscribe()
    })

    it('should call listener with new theme', () => {
      let capturedTheme: any
      const unsubscribe = onThemeChange(theme => {
        capturedTheme = theme
      })
      unsubscribers.push(unsubscribe)

      setTheme('sunset')
      expect(capturedTheme).toBeDefined()

      unsubscribe()
    })

    it('should support multiple listeners', () => {
      let count1 = 0
      let count2 = 0

      const unsub1 = onThemeChange(() => {
        count1++
      })
      const unsub2 = onThemeChange(() => {
        count2++
      })
      unsubscribers.push(unsub1, unsub2)

      setTheme('sunset')

      expect(count1).toBeGreaterThanOrEqual(1)
      expect(count2).toBeGreaterThanOrEqual(1)

      unsub1()
      unsub2()
    })

    it('should unsubscribe listener', () => {
      let callCount = 0
      const unsubscribe = onThemeChange(() => {
        callCount++
      })
      unsubscribers.push(unsubscribe)

      setTheme('sunset')
      const countAfterFirst = callCount
      expect(countAfterFirst).toBeGreaterThanOrEqual(1)

      unsubscribe()

      setTheme('socket')
      expect(callCount).toBe(countAfterFirst) // Should not increase
    })
  })

  describe('edge cases', () => {
    beforeEach(() => {
      setTheme('socket')
    })

    it('should handle rapid theme changes', () => {
      setTheme('socket')
      setTheme('sunset')
      setTheme('socket')
      setTheme('sunset')

      expect(getTheme().name).toBe('sunset')
    })

    it('should handle async and sync theme scoping together', async () => {
      setTheme('socket')

      await withTheme('sunset', async () => {
        withThemeSync('socket', () => {
          expect(getTheme().name).toBe('socket')
        })
        expect(getTheme().name).toBe('sunset')
      })

      expect(getTheme().name).toBe('socket')
    })
  })
})
