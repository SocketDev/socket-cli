/**
 * @fileoverview Elegant theme context management.
 * Async-aware theming with automatic context isolation via AsyncLocalStorage.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

import type { Theme } from './types'
import { SOCKET_THEME, THEMES, type ThemeName } from './themes'

/**
 * Theme change event listener signature.
 */
export type ThemeChangeListener = (theme: Theme) => void

/**
 * AsyncLocalStorage for theme context isolation.
 */
const themeStorage = new AsyncLocalStorage<Theme>()

/**
 * Fallback theme for global context.
 */
let fallbackTheme: Theme = SOCKET_THEME

/**
 * Registered theme change listeners.
 */
const listeners: Set<ThemeChangeListener> = new Set()

/**
 * Set the global fallback theme.
 *
 * @param theme - Theme name or object
 *
 * @example
 * ```ts
 * setTheme('socket-firewall')
 * ```
 */
export function setTheme(theme: Theme | ThemeName): void {
  fallbackTheme = typeof theme === 'string' ? THEMES[theme] : theme
  emitThemeChange(fallbackTheme)
}

/**
 * Get the active theme from context.
 *
 * @returns Current theme
 *
 * @example
 * ```ts
 * const theme = getTheme()
 * console.log(theme.displayName)
 * ```
 */
export function getTheme(): Theme {
  return themeStorage.getStore() ?? fallbackTheme
}

/**
 * Execute async operation with scoped theme.
 * Theme automatically restored on completion.
 *
 * @template T - Return type
 * @param theme - Scoped theme
 * @param fn - Async operation
 * @returns Operation result
 *
 * @example
 * ```ts
 * await withTheme('ultra', async () => {
 *   // Operations use Ultra theme
 * })
 * ```
 */
export async function withTheme<T>(
  theme: Theme | ThemeName,
  fn: () => Promise<T>,
): Promise<T> {
  const resolvedTheme: Theme = typeof theme === 'string' ? THEMES[theme] : theme
  return await themeStorage.run(resolvedTheme, async () => {
    emitThemeChange(resolvedTheme)
    return await fn()
  })
}

/**
 * Execute sync operation with scoped theme.
 * Theme automatically restored on completion.
 *
 * @template T - Return type
 * @param theme - Scoped theme
 * @param fn - Sync operation
 * @returns Operation result
 *
 * @example
 * ```ts
 * const result = withThemeSync('coana', () => {
 *   return processData()
 * })
 * ```
 */
export function withThemeSync<T>(theme: Theme | ThemeName, fn: () => T): T {
  const resolvedTheme: Theme = typeof theme === 'string' ? THEMES[theme] : theme
  return themeStorage.run(resolvedTheme, () => {
    emitThemeChange(resolvedTheme)
    return fn()
  })
}

/**
 * Subscribe to theme change events.
 *
 * @param listener - Change handler
 * @returns Unsubscribe function
 *
 * @example
 * ```ts
 * const unsubscribe = onThemeChange((theme) => {
 *   console.log('Theme:', theme.displayName)
 * })
 *
 * // Cleanup
 * unsubscribe()
 * ```
 */
export function onThemeChange(listener: ThemeChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Emit theme change event to listeners.
 * @private
 */
function emitThemeChange(theme: Theme): void {
  for (const listener of listeners) {
    listener(theme)
  }
}
