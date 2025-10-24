/**
 * @fileoverview Intl.ListFormat stub - English comma-separated lists.
 *
 * Real behavior:
 * - Formats lists according to locale-specific rules
 * - Example (Japanese): format(['a', 'b', 'c']) → "a、b、c" (uses 、 separator)
 *
 * Stub behavior:
 * - English format with "and": "a, b, and c"
 * - Always uses conjunction style with Oxford comma
 * - Example: format(['a', 'b']) → "a and b"
 * - Ignores all locale and type parameters
 *
 * Trade-off: English list format is standard and readable for CLI output.
 */

import { IntlBase } from './base.mts'

export class ListFormatStub extends IntlBase {
  locale: string
  type: string

  constructor(_locales?: string | string[], options?: Intl.ListFormatOptions) {
    super()
    this.locale = 'en-US'
    this.type = options?.type || 'conjunction'
  }

  format(list: string[]): string {
    if (!Array.isArray(list) || list.length === 0) {
      return ''
    }
    if (list.length === 1) {
      return String(list[0])
    }
    if (list.length === 2) {
      return `${list[0]} and ${list[1]}`
    }

    // 3+ items: "a, b, and c"
    const last = list[list.length - 1]
    const rest = list.slice(0, -1).join(', ')
    return `${rest}, and ${last}`
  }

  formatToParts(
    list: string[],
  ): Array<{ type: 'element' | 'literal'; value: string }> {
    return [{ type: 'element', value: this.format(list) }]
  }

  resolvedOptions(): Intl.ResolvedListFormatOptions {
    return {
      locale: 'en-US',
      style: 'long',
      type: this.type as 'conjunction' | 'disjunction' | 'unit',
    }
  }
}
