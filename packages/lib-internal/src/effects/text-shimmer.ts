/**
 * @fileoverview Text shimmer animation utilities.
 * Provides animated highlight effects for spinner text with configurable directions:
 * - LTR (left-to-right): Shimmer wave moves from left to right
 * - RTL (right-to-left): Shimmer wave moves from right to left
 * - Bidirectional: Alternates between LTR and RTL each cycle
 * - Random: Picks a random direction each cycle
 * - None: No shimmer animation
 *
 * The shimmer effect creates a bright wave that travels across the text,
 * with characters near the wave appearing nearly white and fading to the
 * base color as they get further from the wave position.
 */

import { ANSI_RESET, stripAnsi } from '../ansi'
import { isArray } from '../arrays'
import { getCI } from '#env/ci'
import { resolveColor } from '../themes/utils'
import { THEMES } from '../themes/themes'
import type { ColorValue } from '../spinner'

import type {
  ShimmerColorGradient,
  ShimmerColorRgb,
  ShimmerDirection,
  ShimmerState,
} from './types'

// Re-export types for backward compatibility.
export type {
  ShimmerColor,
  ShimmerColorGradient,
  ShimmerColorInherit,
  ShimmerColorRgb,
  ShimmerConfig,
  ShimmerDirection,
  ShimmerState,
} from './types'

/**
 * Detected text formatting styles from ANSI codes.
 */
type TextStyles = {
  bold: boolean
  dim: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
}

/**
 * Detect all text formatting styles present in ANSI-coded text.
 * Checks for bold, dim, italic, underline, and strikethrough.
 */
function detectStyles(text: string): TextStyles {
  return {
    __proto__: null,
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence detection.
    bold: /\x1b\[1m/.test(text),
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence detection.
    dim: /\x1b\[2m/.test(text),
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence detection.
    italic: /\x1b\[3m/.test(text),
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence detection.
    strikethrough: /\x1b\[9m/.test(text),
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence detection.
    underline: /\x1b\[4m/.test(text),
  } as TextStyles
}

/**
 * Build ANSI code string from text styles.
 * Returns the concatenated ANSI codes needed to apply the styles.
 */
function stylesToAnsi(styles: TextStyles): string {
  let codes = ''
  if (styles.bold) {
    codes += '\x1b[1m'
  }
  if (styles.dim) {
    codes += '\x1b[2m'
  }
  if (styles.italic) {
    codes += '\x1b[3m'
  }
  if (styles.underline) {
    codes += '\x1b[4m'
  }
  if (styles.strikethrough) {
    codes += '\x1b[9m'
  }
  return codes
}

// Internal options for applyShimmer function.
type ShimmerOptions = {
  readonly color?: ShimmerColorRgb | ShimmerColorGradient | undefined
  readonly direction?: ShimmerDirection | undefined
  readonly shimmerWidth?: number | undefined
  readonly styles?: TextStyles | undefined
  readonly theme?:
    | import('../themes/types').Theme
    | import('../themes/themes').ThemeName
    | undefined
}

export const COLOR_INHERIT = 'inherit'

export const DIR_LTR = 'ltr'

export const DIR_NONE = 'none'

export const DIR_RANDOM = 'random'

export const DIR_RTL = 'rtl'

export const MODE_BI = 'bi'

/**
 * Calculate shimmer intensity based on distance from shimmer wave position.
 * Uses a power curve for smooth falloff - characters close to the wave
 * get high intensity (bright white), while distant characters get 0.
 */
function shimmerIntensity(
  distance: number,
  shimmerWidth: number = 2.5,
): number {
  // Characters beyond shimmer width get no effect.
  if (distance > shimmerWidth) {
    return 0
  }
  // Smooth falloff using power curve.
  const normalized = distance / shimmerWidth
  return (1 - normalized) ** 2.5
}

/**
 * Blend two RGB colors based on a blend factor (0-1).
 * factor 0 = color1, factor 1 = color2, factor 0.5 = 50/50 blend.
 */
function blendColors(
  color1: readonly [number, number, number],
  color2: readonly [number, number, number],
  factor: number,
): readonly [number, number, number] {
  const r = Math.round(color1[0] + (color2[0] - color1[0]) * factor)
  const g = Math.round(color1[1] + (color2[1] - color1[1]) * factor)
  const b = Math.round(color1[2] + (color2[2] - color1[2]) * factor)
  return [r, g, b] as const
}

/**
 * Render character with shimmer effect based on distance from shimmer position.
 * Characters closer to the shimmer position get brighter (nearly white),
 * while characters further away use the base color.
 * Creates a smooth gradient by blending base color with white based on intensity.
 * Supports both single color and per-character color gradients.
 */
function renderChar(
  char: string,
  index: number,
  shimmerPos: number,
  baseColor: readonly [number, number, number] | ShimmerColorGradient,
  styles: TextStyles,
): string {
  // Calculate how far this character is from the shimmer wave.
  const distance = Math.abs(index - shimmerPos)
  const intensity = shimmerIntensity(distance)

  const styleCode = stylesToAnsi(styles)

  // Get base color for this character (single or per-character from gradient).
  const charColor: readonly [number, number, number] = isArray(baseColor[0])
    ? ((baseColor as ShimmerColorGradient)[index % baseColor.length] ?? [
        140, 82, 255,
      ])
    : (baseColor as readonly [number, number, number])

  // If no shimmer intensity, use base color as-is.
  if (intensity === 0) {
    const base = `\x1b[38;2;${charColor[0]};${charColor[1]};${charColor[2]}m`
    return `${styleCode}${base}${char}${ANSI_RESET}`
  }

  // Blend base color with white based on intensity to create smooth gradient.
  // Higher intensity = more white, creating the shimmer wave effect.
  const white: readonly [number, number, number] = [255, 255, 255] as const
  const blended = blendColors(charColor, white, intensity)

  const color = `\x1b[38;2;${blended[0]};${blended[1]};${blended[2]}m`
  return `${styleCode}${color}${char}${ANSI_RESET}`
}

/**
 * Calculate shimmer wave position for current animation step.
 * The shimmer wave moves across the text length, with extra space
 * for the wave to fade in/out at the edges.
 */
function getShimmerPos(
  textLength: number,
  step: number,
  currentDir: 'ltr' | 'rtl',
  shimmerWidth: number = 2.5,
): number {
  // Total steps for one complete cycle (text length + fade in/out space).
  const totalSteps = textLength + shimmerWidth + 2

  // RTL: Shimmer moves from right to left.
  if (currentDir === DIR_RTL) {
    return textLength - (step % totalSteps)
  }

  // LTR: Shimmer moves from left to right.
  return step % totalSteps
}

/**
 * Resolve shimmer direction to a concrete 'ltr' or 'rtl' value.
 * Used for initializing shimmer state and picking random directions.
 */
function pickDirection(direction: ShimmerDirection): 'ltr' | 'rtl' {
  // Random mode: 50/50 chance of LTR or RTL.
  if (direction === DIR_RANDOM) {
    return Math.random() < 0.5 ? DIR_LTR : DIR_RTL
  }
  // RTL mode: Use RTL direction.
  if (direction === DIR_RTL) {
    return DIR_RTL
  }
  // LTR mode (or any other): Default to LTR.
  return DIR_LTR
}

/**
 * Apply shimmer animation effect to text.
 * This is the main entry point for shimmer animations. It:
 * 1. Strips ANSI codes to get plain text for character positioning
 * 2. Detects any styling (bold, italic, underline, etc.) to preserve
 * 3. Calculates the current shimmer wave position based on animation step
 * 4. Renders each character with appropriate brightness based on distance from wave
 * 5. Updates the animation state for the next frame
 * 6. Handles direction changes for bidirectional and random modes
 */
export function applyShimmer(
  text: string,
  state: ShimmerState,
  options?: ShimmerOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as ShimmerOptions
  const direction = opts.direction ?? DIR_NONE
  const shimmerWidth = opts.shimmerWidth ?? 2.5

  // Resolve color from theme or use provided color or default Socket purple.
  let color: ShimmerColorRgb | ShimmerColorGradient
  if (opts.theme) {
    // Resolve theme to Theme object
    const theme =
      typeof opts.theme === 'string' ? THEMES[opts.theme] : opts.theme
    // Use theme's primary color
    const themeColor = resolveColor(
      theme.colors.primary,
      theme.colors,
    ) as ColorValue
    // Convert ColorValue to ShimmerColorRgb
    // Fallback to Socket purple if color is a string
    color =
      typeof themeColor === 'string' ? ([140, 82, 255] as const) : themeColor
  } else {
    color = opts.color ?? ([140, 82, 255] as const)
  }

  // Detect text formatting styles from original text.
  const styles = opts.styles ?? detectStyles(text)

  // Strip ANSI codes to get plain text.
  const plainText = stripAnsi(text)

  // No shimmer effect in CI or when direction is 'none'.
  if (getCI() || !plainText || direction === DIR_NONE) {
    const styleCode = stylesToAnsi(styles)

    // Support gradient colors (array of colors, one per character).
    const isGradient = isArray(color[0])

    return plainText
      .split('')
      .map((char, i) => {
        const charColor: readonly [number, number, number] = isGradient
          ? ((color as ShimmerColorGradient)[i % color.length] ?? [
              140, 82, 255,
            ])
          : (color as readonly [number, number, number])
        const base = `\x1b[38;2;${charColor[0]};${charColor[1]};${charColor[2]}m`
        return `${styleCode}${base}${char}${ANSI_RESET}`
      })
      .join('')
  }

  // Calculate shimmer position.
  const shimmerPos = getShimmerPos(
    plainText.length,
    state.step,
    state.currentDir,
    shimmerWidth,
  )

  // Render text with shimmer.
  const result = plainText
    .split('')
    .map((char, i) => renderChar(char, i, shimmerPos, color, styles))
    .join('')

  // Advance shimmer position by speed amount each frame.
  // Speed represents steps per frame (e.g., 0.33 = advance 0.33 steps per frame).
  // This creates smooth animation by moving in small increments every frame
  // instead of jumping larger distances every N frames.
  state.step += state.speed

  // Handle bidirectional direction changes.
  const totalSteps = plainText.length + shimmerWidth + 2
  if (state.mode === MODE_BI) {
    if (state.step >= totalSteps) {
      state.step = 0
      // Toggle direction every cycle.
      state.currentDir = state.currentDir === DIR_LTR ? DIR_RTL : DIR_LTR
    }
  } else if (state.mode === DIR_RANDOM) {
    // Change direction randomly at end of each cycle.
    if (state.step >= totalSteps) {
      state.step = 0
      state.currentDir = pickDirection(DIR_RANDOM)
    }
  } else {
    // Reset for continuous loops.
    if (state.step >= totalSteps) {
      state.step = 0
    }
  }

  return result
}
