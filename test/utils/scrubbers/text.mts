/** @fileoverview Text normalization scrubbers for test snapshots. */

/**
 * Normalize log symbols to ASCII equivalents for consistent snapshots.
 * Maps Unicode symbols to basic ASCII characters.
 */
export function normalizeLogSymbols(str: string): string {
  return str
    .replaceAll('✖', '×')
    .replaceAll('ℹ', 'i')
    .replaceAll('✔', '√')
    .replaceAll('⚠', '‼')
}

/**
 * Normalize newlines to LF for consistent snapshots across platforms.
 */
export function normalizeNewlines(str: string): string {
  return (
    str
      // Replace all literal \r\n.
      .replaceAll('\r\n', '\n')
      // Replace all escaped \\r\\n.
      .replaceAll('\\r\\n', '\\n')
  )
}

/**
 * Strip zero-width spaces that may appear in output.
 */
export function stripZeroWidthSpace(str: string): string {
  return str.replaceAll('\u200b', '')
}

/**
 * Convert non-ASCII characters to escape sequences for safe snapshots.
 */
export function toAsciiSafeString(str: string): string {
  // Match characters outside printable ASCII range (32-126) excluding newlines/tabs.
  const asciiUnsafeRegexp = /[^\n\t\x20-\x7e]/g
  return str.replace(asciiUnsafeRegexp, m => {
    const code = m.charCodeAt(0)
    return code < 255
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u${code.toString(16).padStart(4, '0')}`
  })
}
