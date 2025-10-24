/**
 * @fileoverview Intl.DisplayNames stub - Returns input code without translation.
 *
 * Real behavior:
 * - Translates language/region/currency codes to localized names
 * - Example: of('US') with type 'region' → "United States" (in English)
 *
 * Stub behavior:
 * - Returns the input code unchanged (no translation database)
 * - Example: of('US') → "US"
 * - Ignores all locale and type parameters
 *
 * Trade-off: Codes are understandable without translation (e.g., "en-US", "USD").
 */

import { IntlBase } from './base.mts'

export class DisplayNamesStub extends IntlBase {
  locale: string
  type: string

  constructor(_locales: string | string[], options: Intl.DisplayNamesOptions) {
    super()
    this.locale = 'en-US'
    this.type = options?.type || 'language'
  }

  of(code: string): string | undefined {
    // Just return the code itself (no translation).
    return code
  }

  resolvedOptions(): Intl.ResolvedDisplayNamesOptions {
    return {
      fallback: 'code',
      locale: 'en-US',
      style: 'long',
      type: this.type as Intl.DisplayNamesType,
    }
  }
}
