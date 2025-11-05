/**
 * @fileoverview Elegant theming system for Socket libraries.
 * Unified visual language across spinners, loggers, prompts, and links.
 *
 * @example
 * ```ts
 * import { setTheme, THEMES } from '@socketsecurity/lib/themes'
 *
 * // Set global theme
 * setTheme('terracotta')
 * ```
 *
 * @example
 * ```ts
 * import { withTheme } from '@socketsecurity/lib/themes'
 *
 * // Scoped theme context
 * await withTheme('ultra', async () => {
 *   // All operations inherit Ultra theme
 * })
 * ```
 *
 * @example
 * ```ts
 * import { createTheme } from '@socketsecurity/lib/themes'
 *
 * // Custom theme creation
 * const myTheme = createTheme({
 *   name: 'custom',
 *   displayName: 'Custom Theme',
 *   colors: {
 *     primary: [255, 100, 200],
 *     success: 'greenBright',
 *     error: 'redBright',
 *     warning: 'yellowBright',
 *     info: 'blueBright',
 *     step: 'cyanBright',
 *     text: 'white',
 *     textDim: 'gray',
 *     link: 'cyanBright',
 *     prompt: 'primary'
 *   }
 * })
 * ```
 */

// Type system
export type {
  ColorReference,
  Theme,
  ThemeColors,
  ThemeEffects,
  ThemeMeta,
} from './types'

// Curated themes
export {
  LUSH_THEME,
  SOCKET_THEME,
  SUNSET_THEME,
  TERRACOTTA_THEME,
  THEMES,
  ULTRA_THEME,
  type ThemeName,
} from './themes'

// Context management
export {
  getTheme,
  onThemeChange,
  setTheme,
  withTheme,
  withThemeSync,
  type ThemeChangeListener,
} from './context'

// Composition utilities
export {
  createTheme,
  extendTheme,
  resolveColor,
  resolveShimmerColor,
} from './utils'
