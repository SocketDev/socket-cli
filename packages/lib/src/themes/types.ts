/**
 * @fileoverview Elegant theme type system.
 * Type-safe theming for spinners, loggers, prompts, and links.
 */

import type { ColorValue, SpinnerStyle } from '../spinner'
import type { ShimmerDirection } from '../effects/text-shimmer'

/**
 * Color reference — direct value or semantic keyword.
 * Keywords: 'primary', 'secondary', 'inherit', 'rainbow'
 */
export type ColorReference =
  | ColorValue
  | 'primary'
  | 'secondary'
  | 'inherit'
  | 'rainbow'

/**
 * Theme color palette — semantic colors for visual harmony.
 */
export type ThemeColors = {
  /** Primary brand identity */
  primary: ColorValue
  /** Secondary accent (optional) */
  secondary?: ColorValue | undefined

  /** Success indicator ✓ */
  success: ColorValue
  /** Error indicator ✗ */
  error: ColorValue
  /** Warning indicator ⚠ */
  warning: ColorValue
  /** Information indicator ℹ */
  info: ColorValue
  /** Progress indicator → */
  step: ColorValue

  /** Primary text */
  text: ColorValue
  /** Dimmed text */
  textDim: ColorValue
  /** Hyperlinks */
  link: ColorReference
  /** Interactive prompts */
  prompt: ColorReference
}

/**
 * Theme effects — animations and visual enhancements.
 */
export type ThemeEffects = {
  /** Spinner configuration */
  spinner?: {
    /** Color (supports theme references) */
    color?: ColorReference | undefined
    /** Animation style */
    style?: SpinnerStyle | string | undefined
  }

  /** Shimmer configuration */
  shimmer?: {
    /** Enable shimmer */
    enabled?: boolean | undefined
    /** Color (single, gradient, or keyword) */
    color?: ColorReference | ColorValue[] | undefined
    /** Direction */
    direction?: ShimmerDirection | undefined
    /** Speed (steps per frame) */
    speed?: number | undefined
  }

  /** Pulse configuration */
  pulse?: {
    /** Speed (milliseconds) */
    speed?: number | undefined
  }
}

/**
 * Theme metadata — descriptive information.
 */
export type ThemeMeta = {
  /** Description */
  description?: string | undefined
  /** Author */
  author?: string | undefined
  /** Version */
  version?: string | undefined
}

/**
 * Theme definition — complete visual identity.
 */
export type Theme = {
  /** Unique identifier (kebab-case) */
  name: string
  /** Display name */
  displayName: string

  /** Color palette */
  colors: ThemeColors

  /** Visual effects (optional) */
  effects?: ThemeEffects | undefined

  /** Metadata (optional) */
  meta?: ThemeMeta | undefined
}
