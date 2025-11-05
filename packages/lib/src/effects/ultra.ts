/**
 * @fileoverview Ultrathink rainbow gradient effect.
 * Provides rainbow gradient color generation for shimmer animations.
 * "Ultrathink" is Claude's intensive thinking mode for deep analysis.
 */

import type { ShimmerColorGradient, ShimmerColorRgb } from './types'

/**
 * Rainbow gradient colors used for ultrathink effect.
 * This gradient cycles through the full color spectrum with smooth transitions.
 */
export const RAINBOW_GRADIENT: ShimmerColorGradient = [
  // Red/pink.
  [255, 100, 120],
  // Orange.
  [255, 140, 80],
  // Yellow/gold.
  [255, 180, 60],
  // Yellow/green.
  [220, 200, 80],
  // Green.
  [120, 200, 100],
  // Cyan/turquoise.
  [80, 200, 180],
  // Blue.
  [80, 160, 220],
  // Purple/violet.
  [140, 120, 220],
  // Pink/magenta.
  [200, 100, 200],
  // Red/pink.
  [255, 100, 140],
]

/**
 * Generate rainbow gradient colors for any text length.
 * Colors are distributed evenly across the text by cycling through the gradient.
 */
export function generateRainbowGradient(
  textLength: number,
): ShimmerColorGradient {
  const colors: ShimmerColorRgb[] = []

  for (let i = 0; i < textLength; i += 1) {
    const colorIndex = i % RAINBOW_GRADIENT.length
    const color = RAINBOW_GRADIENT[colorIndex]
    if (color) {
      colors.push(color)
    }
  }

  return colors as ShimmerColorGradient
}
