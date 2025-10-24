/**
 * @fileoverview Helper functions for Intl stub.
 */

/**
 * Returns canonical locales (always returns ['en-US'] for stub).
 */
export function getCanonicalLocales(
  locales?: string | readonly string[],
): string[] {
  if (Array.isArray(locales)) {
    return locales.length > 0 ? ['en-US'] : []
  }
  return locales ? ['en-US'] : []
}

/**
 * Returns supported values for various Intl properties.
 */
export function supportedValuesOf(
  key:
    | 'calendar'
    | 'collation'
    | 'currency'
    | 'numberingSystem'
    | 'timeZone'
    | 'unit',
): string[] {
  const values: Record<string, string[]> = {
    calendar: ['gregory'],
    collation: ['default'],
    currency: ['USD'],
    numberingSystem: ['latn'],
    timeZone: ['UTC'],
    unit: ['meter', 'second', 'byte'],
  }
  return values[key] || []
}
