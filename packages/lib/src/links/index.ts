/**
 * @fileoverview Themed hyperlink utilities for terminal output.
 * Provides colored hyperlinks using theme configuration.
 */

import yoctocolorsCjs from 'yoctocolors-cjs'
import type { ColorName } from '../spinner'
import { getTheme } from '../themes/context'
import { THEMES } from '../themes/themes'
import { resolveColor } from '../themes/utils'
import type { Theme } from '../themes/types'
import type { ThemeName } from '../themes/themes'

/**
 * Options for creating themed links.
 */
export type LinkOptions = {
  /** Theme to use (overrides global) */
  theme?: Theme | ThemeName | undefined
  /** Show URL as fallback if terminal doesn't support links */
  fallback?: boolean | undefined
}

/**
 * Create a themed hyperlink for terminal output.
 * The link text is colored using the theme's link color.
 *
 * Note: Most terminals support ANSI color codes but not clickable links.
 * This function colors the text but does not create clickable hyperlinks.
 * For clickable links, use a library like 'terminal-link' separately.
 *
 * @param text - Link text to display
 * @param url - URL (included in fallback mode)
 * @param options - Link configuration options
 * @returns Colored link text
 *
 * @example
 * ```ts
 * import { link } from '@socketsecurity/lib/links'
 *
 * // Use current theme
 * console.log(link('Documentation', 'https://socket.dev'))
 *
 * // Override theme
 * console.log(link('API Docs', 'https://api.socket.dev', {
 *   theme: 'coana'
 * }))
 *
 * // Show URL as fallback
 * console.log(link('GitHub', 'https://github.com', {
 *   fallback: true
 * }))
 * // Output: "GitHub (https://github.com)"
 * ```
 */
export function link(text: string, url: string, options?: LinkOptions): string {
  const opts = { __proto__: null, fallback: false, ...options } as LinkOptions

  // Resolve theme
  const theme =
    typeof opts.theme === 'string'
      ? THEMES[opts.theme]
      : (opts.theme ?? getTheme())

  // Resolve link color
  const linkColor = resolveColor(theme.colors.link, theme.colors)

  // Apply color - for now just use cyan as a simple fallback
  // Note: RGB color support to be added in yoctocolors wrapper
  const colors = yoctocolorsCjs
  let colored: string
  if (typeof linkColor === 'string' && linkColor !== 'inherit') {
    // Use named color method if available
    const colorMethod = colors[linkColor as ColorName]
    colored = colorMethod ? colorMethod(text) : colors.cyan(text)
  } else if (Array.isArray(linkColor)) {
    // RGB color - for now fallback to cyan
    // Note: RGB color support to be implemented
    colored = colors.cyan(text)
  } else {
    colored = colors.cyan(text)
  }

  // Return with or without URL fallback
  return opts.fallback ? `${colored} (${url})` : colored
}

/**
 * Create multiple themed links from an array of link specifications.
 *
 * @param links - Array of [text, url] pairs
 * @param options - Link configuration options
 * @returns Array of colored link texts
 *
 * @example
 * ```ts
 * import { links } from '@socketsecurity/lib/links'
 *
 * const formatted = links([
 *   ['Documentation', 'https://socket.dev'],
 *   ['API Reference', 'https://api.socket.dev'],
 *   ['GitHub', 'https://github.com/SocketDev']
 * ])
 *
 * formatted.forEach(link => console.log(link))
 * ```
 */
export function links(
  linkSpecs: Array<[text: string, url: string]>,
  options?: LinkOptions,
): string[] {
  return linkSpecs.map(([text, url]) => link(text, url, options))
}
