/**
 * @file Shared sort helpers for the `socket/sort-*` rules. Every sort rule
 *   extracts a string key per sibling, checks whether the keys are already in
 *   order, and (when not) re-emits them sorted by the same total order. These
 *   two primitives — `stringComparator` and `isAlreadySorted` — were
 *   copy-pasted into each rule; centralizing them keeps the fleet's
 *   alphanumeric order (literal byte order, ASCII before letters) identical
 *   across every sort surface.
 */

/**
 * Total order over two strings: -1 / 0 / 1 by literal byte (`<` / `>`)
 * comparison. ASCII punctuation and digits sort before letters, matching the
 * fleet's "alphanumeric" convention. Pass extracted sort keys, not nodes.
 */
export function stringComparator(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * True when `keys` are already in non-decreasing byte order — the fast-path
 * guard a sort rule runs before building a sorted copy + reporting.
 */
export function isAlreadySorted(keys: readonly string[]): boolean {
  for (let i = 1, { length } = keys; i < length; i += 1) {
    if (keys[i - 1]! > keys[i]!) {
      return false
    }
  }
  return true
}
