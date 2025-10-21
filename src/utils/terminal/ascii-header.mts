/**
 * @fileoverview Animated ASCII header utilities with shimmer effects.
 *
 * Provides themable, animated Socket CLI ASCII art headers with gradient shimmer effects.
 * Supports both static (fast) rendering and animated (shimmer) rendering modes.
 */

import colors from 'yoctocolors-cjs'

import { applyShimmer } from '@socketsecurity/lib/effects/text-shimmer'

import type {
  ShimmerColorGradient,
  ShimmerState,
} from '@socketsecurity/lib/effects/text-shimmer'


/**
 * Color themes for header styling.
 */
export type HeaderTheme = 'default' | 'cyberpunk' | 'forest' | 'ocean' | 'sunset'

/**
 * Theme color definitions with gradient support (RGB tuples).
 */
const THEME_COLORS_RGB = {
  __proto__: null,
  default: [
    [139, 92, 246],
    [167, 139, 250],
    [196, 181, 253],
    [221, 214, 254],
  ] as const,
  cyberpunk: [
    [255, 0, 255],
    [0, 255, 255],
    [255, 0, 170],
    [0, 170, 255],
  ] as const,
  forest: [
    [16, 185, 129],
    [52, 211, 153],
    [110, 231, 183],
    [167, 243, 208],
  ] as const,
  ocean: [
    [14, 165, 233],
    [56, 189, 248],
    [125, 211, 252],
    [186, 230, 253],
  ] as const,
  sunset: [
    [245, 158, 11],
    [251, 191, 36],
    [252, 211, 77],
    [253, 230, 138],
  ] as const,
} as const

/**
 * Theme color definitions in hex format (for fallback rendering).
 */
const THEME_COLORS_HEX = {
  __proto__: null,
  default: ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE'],
  cyberpunk: ['#FF00FF', '#00FFFF', '#FF00AA', '#00AAFF'],
  forest: ['#10B981', '#34D399', '#6EE7B7', '#A7F3D0'],
  ocean: ['#0EA5E9', '#38BDF8', '#7DD3FC', '#BAE6FD'],
  sunset: ['#F59E0B', '#FBBF24', '#FCD34D', '#FDE68A'],
} as const

/**
 * Socket CLI ASCII art template.
 */
const ASCII_LOGO = [
  '   _____         _       _       ',
  '  |   __|___ ___| |_ ___| |_     ',
  '  |__   | . |  _| \'_| -_|  _|    ',
  '  |_____|___|___|_,_|___|_|.dev  ',
] as const

/**
 * Apply hex color to text using ANSI 24-bit color codes.
 */
function applyHexColor(text: string, hexColor: string): string {
  const r = Number.parseInt(hexColor.slice(1, 3), 16)
  const g = Number.parseInt(hexColor.slice(3, 5), 16)
  const b = Number.parseInt(hexColor.slice(5, 7), 16)
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`
}

/**
 * Render ASCII logo with shimmer effect for given frame.
 * Uses socket-registry's applyShimmer with theme color gradients.
 * Features dual shimmer waves and slanted diagonal movement.
 */
export function renderShimmerFrame(
  frame: number,
  theme: HeaderTheme = 'default',
): string {
  const themeGradient = THEME_COLORS_RGB[theme] as unknown as ShimmerColorGradient

  // Apply shimmer to each line of the ASCII logo with slanted offset.
  const lines: string[] = []
  for (let i = 0; i < ASCII_LOGO.length; i++) {
    const line = ASCII_LOGO[i]!

    // Apply bold formatting first so applyShimmer can detect and preserve it.
    const boldLine = '\x1b[1m' + line + '\x1b[0m'

    // Create slanted shimmer by offsetting each line's frame position.
    // This creates a diagonal wave effect across the logo.
    const slantOffset = i * 4

    // Primary shimmer wave.
    const shimmerState1: ShimmerState = {
      currentDir: 'ltr',
      mode: 'ltr',
      speed: 0.25,
      step: frame + slantOffset,
    }

    // Secondary shimmer wave (offset to create dual wave effect).
    const shimmerState2: ShimmerState = {
      currentDir: 'ltr',
      mode: 'ltr',
      speed: 0.25,
      step: frame + slantOffset + 35,
    }

    // Apply first shimmer pass (will detect and preserve bold).
    const shimmered1 = applyShimmer(boldLine, shimmerState1, {
      color: themeGradient,
      direction: 'ltr',
    })

    // Apply second shimmer pass for dual wave effect.
    const shimmered2 = applyShimmer(shimmered1, shimmerState2, {
      color: themeGradient,
      direction: 'ltr',
    })

    lines.push(shimmered2)
  }

  return lines.join('\n')
}

/**
 * Render static ASCII logo with single color from theme.
 */
export function renderStaticLogo(theme: HeaderTheme = 'default'): string {
  const themeColors = THEME_COLORS_HEX[theme]
  const primaryColor = themeColors[0]!
  return ASCII_LOGO.map(line =>
    applyHexColor(line, primaryColor)
  ).join('\n')
}

/**
 * Check if terminal supports 24-bit color.
 */
export function supportsFullColor(): boolean {
  const { COLORTERM, TERM, TERM_PROGRAM } = process.env
  return !!(
    COLORTERM === 'truecolor' ||
    COLORTERM === '24bit' ||
    TERM?.includes('24bit') ||
    TERM?.includes('truecolor') ||
    TERM_PROGRAM === 'iTerm.app' ||
    TERM_PROGRAM === 'Hyper' ||
    TERM_PROGRAM === 'vscode'
  )
}

/**
 * Render ASCII logo with fallback for terminals without 24-bit color.
 */
export function renderLogoWithFallback(
  frame: number | null = null,
  theme: HeaderTheme = 'default',
): string {
  // If frame is provided and terminal supports full color, use shimmer.
  if (frame !== null && supportsFullColor()) {
    return renderShimmerFrame(frame, theme)
  }

  // Static rendering for terminals without full color support.
  // Use simple yoctocolors for compatibility.
  const themeToColor = {
    __proto__: null,
    default: colors.magenta,
    cyberpunk: colors.cyan,
    forest: colors.green,
    ocean: colors.blue,
    sunset: colors.yellow,
  } as const

  const colorFn = themeToColor[theme]
  return ASCII_LOGO.map(line => colorFn(line)).join('\n')
}

/**
 * Format header info line with theme colors.
 */
export function formatInfoLine(
  text: string,
  theme: HeaderTheme = 'default',
): string {
  const themeColors = THEME_COLORS_HEX[theme]
  const accentColor = themeColors[1]!
  return applyHexColor(text, accentColor)
}
