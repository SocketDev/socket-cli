/**
 * String manipulation utilities for Socket CLI.
 * Provides common string transformations and formatting.
 *
 * Key Functions:
 * - camelToKebab: Convert camelCase to kebab-case
 * - indentString, isNonEmptyString, stripAnsi, stripBom, trimNewlines: string helpers
 *
 * Usage:
 * - Command name transformations
 * - Flag name conversions
 * - Consistent string formatting
 */

export function camelToKebab(str: string): string {
  return str === '' ? '' : str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

export function indentString(str: string, count = 1): string {
  return str.replace(/^(?!\s*$)/gm, ' '.repeat(count))
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// Inlined ansi-regex from ansi-regex 6.2.2.
// https://socket.dev/npm/package/ansi-regexp/overview/6.2.2
// MIT License
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
function ansiRegex(): RegExp {
  // Valid string terminator sequences are BEL, ESC\\, and 0x9c.
  const ST = '(?:\\u0007|\\u001B\\u005C|\\u009C)'
  // OSC sequences only: ESC ] ... ST (non-greedy until the first ST).
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`
  // CSI and related: ESC/C1, optional intermediates, optional params (supports ; and :) then final byte.
  const csi =
    '[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]'
  return new RegExp(`${osc}|${csi}`, 'g')
}

export function stripAnsi(str: string): string {
  return str.replace(ansiRegex(), '')
}

export function stripBom(str: string): string {
  return str.length > 0 && str.charCodeAt(0) === 0xfeff ? str.slice(1) : str
}

export function trimNewlines(str: string): string {
  const { length } = str
  if (length === 0) {
    return str
  }
  const first = str.charCodeAt(0)
  const noFirstNewline = first !== 13 && first !== 10
  if (length === 1) {
    return noFirstNewline ? str : ''
  }
  const last = str.charCodeAt(length - 1)
  const noLastNewline = last !== 13 && last !== 10
  if (noFirstNewline && noLastNewline) {
    return str
  }
  let start = 0
  let end = length
  while (start < end) {
    const code = str.charCodeAt(start)
    if (code !== 13 && code !== 10) {
      break
    }
    start += 1
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1)
    if (code !== 13 && code !== 10) {
      break
    }
    end -= 1
  }
  return start === 0 && end === length ? str : str.slice(start, end)
}
