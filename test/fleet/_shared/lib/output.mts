/**
 * @file Fleet-canonical output normalization for tests: strip ANSI color/style
 *   escapes and trim, so assertions match the plain text a user reads rather
 *   than the styled bytes a TTY renders. Wraps the single-source-of-truth
 *   `stripAnsi` from `@socketsecurity/lib-stable/ansi/strip` (the same helper
 *   socket-cli's test utils use) so there's one ANSI definition fleet-wide.
 *   Pairs with `./platform.mts` (path normalization) — reach for `cleanOutput`
 *   instead of hand-rolling an ANSI regex at each call site.
 */

import { stripAnsi } from '@socketsecurity/lib-stable/ansi/strip'

// Decorative glyphs the fleet loggers prefix (⚡ banner, ✧ sparkle, and the
// bare variation-selector that can trail an emoji) — stripped alongside ANSI so
// output assertions don't depend on cosmetic chrome.
const DECORATIVE_RE = /(?:⚡|✧|︎)\s*/g

/**
 * Strip ANSI escapes + decorative glyphs and trim. Use on captured stdout/
 * stderr before asserting on its text content.
 */
export function cleanOutput(text: string): string {
  return stripAnsi(text).replace(DECORATIVE_RE, '').trim()
}

/**
 * Strip ANSI + decorative glyphs WITHOUT trimming — for when leading/trailing
 * whitespace is part of what's under test (column alignment, indentation).
 */
export function stripDecoration(text: string): string {
  return stripAnsi(text).replace(DECORATIVE_RE, '')
}
