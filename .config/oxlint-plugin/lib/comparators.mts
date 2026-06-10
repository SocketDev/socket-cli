/**
 * @file Shared sort helpers for the `socket/sort-*` rules. Every sort rule
 *   extracts a string key per sibling, checks whether the keys are already in
 *   order, and (when not) re-emits them sorted by the same total order. These
 *   two primitives — `stringComparator` and `isAlreadySorted` — were
 *   copy-pasted into each rule; centralizing them keeps the fleet's
 *   alphanumeric order identical across every sort surface. The order is the
 *   fleet's canonical **natural** sort, delegated to `@socketsecurity/lib`'s
 *   `naturalCompare`: case-insensitive and numeric-aware, so `apple, Mango,
 *   zebra` (not ASCII `Mango, apple, zebra`) and `item1, item2, item10` (not
 *   `item1, item10, item2`). Both primitives share the one comparator so the
 *   "already sorted" fast-path can never disagree with the sorter it guards.
 */

import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'

/**
 * Total order over two strings: the fleet's natural comparator
 * (case-insensitive + numeric-aware) from `@socketsecurity/lib`. Pass extracted
 * sort keys, not nodes.
 */
export function stringComparator(a: string, b: string): number {
  return naturalCompare(a, b)
}

/**
 * True when `keys` are already in non-decreasing natural order — the fast-path
 * guard a sort rule runs before building a sorted copy + reporting. Shares the
 * comparator with `stringComparator` so the two never disagree.
 */
export function isAlreadySorted(keys: readonly string[]): boolean {
  for (let i = 1, { length } = keys; i < length; i += 1) {
    if (stringComparator(keys[i - 1]!, keys[i]!) > 0) {
      return false
    }
  }
  return true
}
