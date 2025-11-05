/**
 * @fileoverview Socket pulse animation frames generator.
 * Generates themeable pulsing animation frames using sparkles (✧ ✦) and lightning (⚡).
 * Follows the cli-spinners format: https://github.com/sindresorhus/cli-spinners
 */

export type SocketFramesOptions = {
  readonly baseColor?: readonly [number, number, number] | undefined
  readonly interval?: number | undefined
  /**
   * Theme to use for pulse colors.
   * Can be a theme name ('socket', 'sunset', etc.) or a Theme object.
   * Note: Currently frames only contain brightness modifiers.
   * Colors are applied by yocto-spinner based on spinner.color.
   */
  readonly theme?:
    | import('../themes/types').Theme
    | import('../themes/themes').ThemeName
    | undefined
}

/**
 * Generate Socket pulse animation frames.
 * Creates a pulsing throbber using Unicode sparkles and lightning symbols.
 * Frames use brightness modifiers (bold/dim) but no embedded colors.
 * Yocto-spinner applies the current spinner color to each frame.
 *
 * Returns a spinner definition compatible with cli-spinners format.
 *
 * @see https://github.com/sindresorhus/cli-spinners/blob/main/spinners.json
 */
export function generateSocketSpinnerFrames(
  options?: SocketFramesOptions | undefined,
): {
  frames: string[]
  interval: number
} {
  const opts = { __proto__: null, ...options } as SocketFramesOptions
  const interval = opts.interval ?? 50

  // ANSI codes for brightness modifiers only (no colors).
  // Yocto-spinner will apply the spinner's current color to each frame.
  const bold = '\x1b[1m'
  const dim = '\x1b[2m'
  const reset = '\x1b[0m'

  // Using VS15 (\uFE0E) to force text-style rendering.
  // Lightning bolt (⚡) is wider than stars. To keep consistent spacing:
  // - All frames have NO internal padding
  // - Yocto-spinner adds 1 space after each frame
  // - Success/fail symbols also get 1 space (consistent)
  const lightning = '⚡\uFE0E'
  const starFilled = '✦\uFE0E '
  const starOutline = '✧\uFE0E '
  const starTiny = '⋆\uFE0E '

  // Pulse frames with brightness modifiers only.
  // Each frame gets colored by yocto-spinner based on current spinner.color.
  // Yocto-spinner adds 1 space after the frame automatically.
  const frames = [
    // Build up from dim to bright
    `${dim}${starOutline}${reset}`,
    `${dim}${starOutline}${reset}`,
    `${dim}${starTiny}${reset}`,
    `${starFilled}${reset}`,
    `${starFilled}${reset}`,
    `${bold}${starFilled}${reset}`,
    `${bold}${starFilled}${reset}`,
    `${bold}${lightning}${reset}`,
    `${bold}${lightning}${reset}`,
    `${bold}${lightning}${reset}`,
    // Fade down
    `${bold}${lightning}${reset}`,
    `${bold}${lightning}${reset}`,
    `${bold}${starFilled}${reset}`,
    `${bold}${starFilled}${reset}`,
    `${starFilled}${reset}`,
    `${starFilled}${reset}`,
    `${dim}${starTiny}${reset}`,
    `${dim}${starOutline}${reset}`,
  ]

  return {
    __proto__: null,
    frames,
    interval,
  } as { frames: string[]; interval: number }
}
