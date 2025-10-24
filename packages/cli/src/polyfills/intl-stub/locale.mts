/**
 * @fileoverview Intl.Locale stub - Simple locale representation.
 *
 * Real behavior:
 * - Parses and canonicalizes locale identifiers
 * - Provides properties like language, region, script, etc.
 * - Example: new Intl.Locale('en-GB') → {language: 'en', region: 'GB'}
 *
 * Stub behavior:
 * - Always returns 'en-US' as the base name
 * - Provides minimal properties with defaults
 * - Ignores all options
 *
 * Trade-off: Simple locale representation is sufficient for CLI tools.
 */

import { IntlBase } from './base.mts'

export class LocaleStub extends IntlBase {
  baseName: string
  language: string

  constructor(_tag?: string, _options?: Intl.LocaleOptions) {
    super()
    this.baseName = 'en-US'
    this.language = 'en'
  }

  override toString(): string {
    return this.baseName
  }
}
