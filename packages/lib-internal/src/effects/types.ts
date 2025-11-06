/**
 * @fileoverview Shared types for effects (shimmer, pulse, ultra, etc.).
 * Common type definitions used across multiple effect modules.
 */

export type ShimmerColorInherit = 'inherit'

export type ShimmerColorRgb = readonly [number, number, number]

export type ShimmerColor = ShimmerColorInherit | ShimmerColorRgb

export type ShimmerColorGradient = readonly ShimmerColorRgb[]

export type ShimmerDirection = 'ltr' | 'rtl' | 'bi' | 'random' | 'none'

/**
 * Shimmer animation configuration.
 */
export type ShimmerConfig = {
  readonly color?: ShimmerColor | ShimmerColorGradient | undefined
  readonly dir?: ShimmerDirection | undefined
  /**
   * Animation speed in steps per frame.
   * Lower values = slower shimmer (e.g., 0.33 = ~150ms per step).
   * Higher values = faster shimmer (e.g., 1.0 = 50ms per step).
   * Default: 1/3 (~0.33).
   */
  readonly speed?: number | undefined
  /**
   * Theme to use for shimmer colors.
   * Can be a theme name ('socket', 'sunset', etc.) or a Theme object.
   * If provided, overrides the color option.
   */
  readonly theme?:
    | import('../themes/types').Theme
    | import('../themes/themes').ThemeName
    | undefined
}

/**
 * Internal shimmer animation state.
 * Tracks current animation position and direction.
 */
export type ShimmerState = {
  currentDir: 'ltr' | 'rtl'
  mode: ShimmerDirection
  /**
   * Animation speed in steps per frame.
   * The shimmer position advances by this amount every frame.
   */
  speed: number
  /**
   * Current shimmer position.
   * Can be fractional for smooth sub-character movement.
   */
  step: number
}
