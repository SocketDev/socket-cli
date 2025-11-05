/**
 * @fileoverview Theme utilities — color resolution and composition.
 */

import { RAINBOW_GRADIENT } from '../effects/ultra'
import type { ColorValue } from '../spinner'
import type { ShimmerColorGradient } from '../effects/text-shimmer'
import type { Theme, ThemeColors, ColorReference } from './types'

/**
 * Resolve color reference to concrete value.
 * Handles semantic keywords: 'primary', 'secondary', 'rainbow', 'inherit'
 *
 * @param value - Color reference
 * @param colors - Theme palette
 * @returns Resolved color
 *
 * @example
 * ```ts
 * resolveColor('primary', theme.colors)
 * resolveColor([255, 0, 0], theme.colors)
 * ```
 */
export function resolveColor(
  value: ColorReference | ColorValue,
  colors: ThemeColors,
): ColorValue | 'inherit' | ShimmerColorGradient {
  if (typeof value === 'string') {
    if (value === 'primary') {
      return colors.primary
    }
    if (value === 'secondary') {
      return colors.secondary ?? colors.primary
    }
    if (value === 'inherit') {
      return 'inherit'
    }
    if (value === 'rainbow') {
      return RAINBOW_GRADIENT
    }
    return value as ColorValue
  }
  return value as ColorValue
}

/**
 * Resolve shimmer color with gradient support.
 *
 * @param value - Shimmer color
 * @param theme - Theme context
 * @returns Resolved color
 *
 * @example
 * ```ts
 * resolveShimmerColor('rainbow', theme)
 * resolveShimmerColor('primary', theme)
 * ```
 */
export function resolveShimmerColor(
  value: ColorReference | ColorValue[] | undefined,
  theme: Theme,
): ColorValue | ShimmerColorGradient | 'inherit' {
  if (!value) {
    return 'inherit'
  }
  if (value === 'rainbow') {
    return RAINBOW_GRADIENT
  }
  if (value === 'inherit') {
    return 'inherit'
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0])) {
      // Gradient
      return value as ShimmerColorGradient
    }
    // Single RGB
    return value as unknown as ColorValue
  }
  return resolveColor(value as ColorReference, theme.colors)
}

/**
 * Extend existing theme with custom overrides.
 * Deep merge of colors and effects.
 *
 * @param base - Base theme
 * @param overrides - Custom overrides
 * @returns Extended theme
 *
 * @example
 * ```ts
 * const custom = extendTheme(SOCKET_THEME, {
 *   name: 'custom',
 *   colors: { primary: [255, 100, 200] }
 * })
 * ```
 */
export function extendTheme(
  base: Theme,
  overrides: Partial<Omit<Theme, 'colors'>> & {
    colors?: Partial<ThemeColors> | undefined
  },
): Theme {
  return {
    __proto__: null,
    ...base,
    ...overrides,
    colors: {
      __proto__: null,
      ...base.colors,
      ...overrides.colors,
    } as ThemeColors,
    effects: overrides.effects
      ? {
          __proto__: null,
          ...base.effects,
          ...overrides.effects,
          spinner:
            overrides.effects.spinner !== undefined
              ? {
                  __proto__: null,
                  ...base.effects?.spinner,
                  ...overrides.effects.spinner,
                }
              : base.effects?.spinner,
          shimmer:
            overrides.effects.shimmer !== undefined
              ? {
                  __proto__: null,
                  ...base.effects?.shimmer,
                  ...overrides.effects.shimmer,
                }
              : base.effects?.shimmer,
          pulse:
            overrides.effects.pulse !== undefined
              ? {
                  __proto__: null,
                  ...base.effects?.pulse,
                  ...overrides.effects.pulse,
                }
              : base.effects?.pulse,
        }
      : base.effects,
    meta: overrides.meta
      ? {
          __proto__: null,
          ...base.meta,
          ...overrides.meta,
        }
      : base.meta,
  } as Theme
}

/**
 * Create new theme from complete specification.
 *
 * @param config - Theme configuration
 * @returns Theme object
 *
 * @example
 * ```ts
 * const theme = createTheme({
 *   name: 'custom',
 *   displayName: 'Custom',
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
export function createTheme(
  config: Pick<Theme, 'name' | 'displayName' | 'colors'> &
    Partial<Omit<Theme, 'name' | 'displayName' | 'colors'>>,
): Theme {
  return {
    __proto__: null,
    name: config.name,
    displayName: config.displayName,
    colors: { __proto__: null, ...config.colors } as ThemeColors,
    effects: config.effects
      ? { __proto__: null, ...config.effects }
      : undefined,
    meta: config.meta ? { __proto__: null, ...config.meta } : undefined,
  } as Theme
}
