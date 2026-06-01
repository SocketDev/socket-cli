/**
 * @file Animated ASCII header utilities with shimmer effects. Provides
 *   themable, animated Socket CLI ASCII art headers with gradient shimmer
 *   effects. Supports both static (fast) rendering and animated (shimmer)
 *   rendering modes.
 */

import colors from 'yoctocolors-cjs'

import {
  configToSpec,
  frameColors,
} from '@socketsecurity/lib-stable/effects/shimmer'
import { colorsToAnsi } from '@socketsecurity/lib-stable/effects/shimmer-terminal'

import type {
  Palette,
  RGB,
  ShimmerSpec,
} from '@socketsecurity/lib-stable/effects/shimmer'

/**
 * Color themes for header styling.
 */
export type HeaderTheme =
  | 'default'
  | 'cyberpunk'
  | 'forest'
  | 'ocean'
  | 'sunset'

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
 * Socket CLI ASCII art template.
 */
const ASCII_LOGO = [
  '   _____         _       _       ',
  '  |   __|___ ___| |_ ___| |_     ',
  "  |__   | . |  _| '_| -_|  _|    ",
  '  |_____|___|___|_,_|___|_|.dev  ',
] as const

/**
 * Pick the brighter of two RGB colors. Used to compose two shimmer waves into
 * one frame: each wave's `frameColors[i]` is computed independently, then
 * merged so the brighter highlight wins per char. Treats luminance as the
 * simple sum of channels — fine here because both waves share base + highlight
 * palettes.
 */
export function brighterRgb(a: RGB, b: RGB): RGB {
  return a[0] + a[1] + a[2] >= b[0] + b[1] + b[2] ? a : b
}

/**
 * Render ASCII logo with fallback for terminals without 24-bit color.
 */
export function renderLogoWithFallback(
  frame: number | undefined = undefined,
  theme: HeaderTheme = 'default',
): string {
  // If frame is provided and terminal supports full color, use shimmer.
  if (frame !== undefined && supportsFullColor()) {
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
 * Render ASCII logo with shimmer effect for given frame.
 *
 * Uses socket-lib's @socketsecurity/lib/effects/shimmer engine (5.26.1+).
 * Builds two ShimmerSpecs per line — primary + secondary offset by 35 frames —
 * and merges their per-char colors with `brighterRgb` so the dual-wave look is
 * preserved. Each line gets a `slantOffset = i * 4` added to the frame counter,
 * producing a diagonal wave across the logo. Applies bold via ANSI before the
 * shimmer's truecolor escape so terminals render the highlight bold.
 */
export function renderShimmerFrame(
  frame: number,
  theme: HeaderTheme = 'default',
): string {
  const themePalette = THEME_COLORS_RGB[theme] as unknown as Palette

  const lines: string[] = []
  for (let i = 0; i < ASCII_LOGO.length; i++) {
    const line = ASCII_LOGO[i]!
    const lineLength = line.length

    // Slant the wave by offsetting each line's frame counter — same
    // 4-frame-per-row delta as the previous implementation.
    const slantOffset = i * 4
    const speed = 0.25

    // Build the shimmer spec once and reuse for both waves — the
    // spec is frame-independent (positionAt is a closure over speed
    // + textLength + direction). The two waves differ only in the
    // frame counter passed to `frameColors`.
    const spec: ShimmerSpec = configToSpec(
      {
        color: themePalette,
        dir: 'ltr',
        speed,
      },
      lineLength,
    )

    // Compute per-char colors for both waves and merge.
    const primaryColors = frameColors(spec, lineLength, frame + slantOffset)
    const secondaryColors = frameColors(
      spec,
      lineLength,
      frame + slantOffset + 35,
    )
    const merged: RGB[] = primaryColors.map((c, idx) =>
      brighterRgb(c, secondaryColors[idx]!),
    )

    // Render to ANSI truecolor + wrap in bold for the brighter look
    // the previous implementation produced. \x1b[1m turns bold on,
    // colorsToAnsi emits per-char truecolor codes, \x1b[0m resets.
    lines.push(`\x1b[1m${colorsToAnsi(line, merged)}\x1b[0m`)
  }

  return lines.join('\n')
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
