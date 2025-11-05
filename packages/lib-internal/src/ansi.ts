/**
 * @fileoverview ANSI escape code utilities.
 * Provides constants and helpers for terminal formatting.
 */

// ANSI escape codes - commonly used sequences.
export const ANSI_RESET = '\x1b[0m'
export const ANSI_BOLD = '\x1b[1m'
export const ANSI_DIM = '\x1b[2m'
export const ANSI_ITALIC = '\x1b[3m'
export const ANSI_UNDERLINE = '\x1b[4m'
export const ANSI_STRIKETHROUGH = '\x1b[9m'

// ANSI escape code regex to strip colors/formatting.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences use control characters.
const ANSI_REGEX = /\x1b\[[0-9;]*m/g

/**
 * Create a regular expression for matching ANSI escape codes.
 *
 * Inlined ansi-regex:
 * https://socket.dev/npm/package/ansi-regexp/overview/6.2.2
 * MIT License
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 */
/*@__NO_SIDE_EFFECTS__*/
export function ansiRegex(options?: { onlyFirst?: boolean }): RegExp {
  const { onlyFirst } = options ?? {}
  // Valid string terminator sequences are BEL, ESC\, and 0x9c.
  const ST = '(?:\\u0007\\u001B\\u005C|\\u009C)'
  // OSC sequences only: ESC ] ... ST (non-greedy until the first ST).
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`
  // CSI and related: ESC/C1, optional intermediates, optional params (supports ; and :) then final byte.
  const csi =
    '[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]'
  const pattern = `${osc}|${csi}`
  return new RegExp(pattern, onlyFirst ? undefined : 'g')
}

/**
 * Strip ANSI escape codes from text.
 * Uses the inlined ansi-regex for matching.
 */
/*@__NO_SIDE_EFFECTS__*/
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}
