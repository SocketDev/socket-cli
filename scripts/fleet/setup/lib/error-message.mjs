/**
 * @file Dep-0 local copy of `@socketsecurity/lib`'s `errorMessage`. The setup
 *   scripts run BEFORE `pnpm install`, so they cannot import
 *   `@socketsecurity/lib`; the fleet rule
 *   `socket/prefer-socket-lib-error-message` still wants the ternary `e
 *   instanceof Error ? e.message : String(e)` gone. This is the faithful copy
 *   the rule points at: same branches as
 *   `@socketsecurity/lib-stable/errors/message`, minus the pony-cause
 *   cause-chain walk that the lib does and a dep-0 file has no dependency for.
 *   Written as `if` statements rather than the flagged ternary, so the rule is
 *   satisfied by real equivalence, not by a disable comment.
 */

/**
 * Extract a human-readable message from any caught value.
 *
 * Returns the Error's own message, or `'Unknown error'` for `null`,
 * `undefined`, an empty string, `'[object Object]'`, or an Error with no
 * message. Every other value is coerced to string.
 */
export function errorMessage(value) {
  if (value instanceof Error) {
    return value.message || 'Unknown error'
  }
  if (value === null || value === undefined) {
    return 'Unknown error'
  }
  const s = String(value)
  if (s === '' || s === '[object Object]') {
    return 'Unknown error'
  }
  return s
}
