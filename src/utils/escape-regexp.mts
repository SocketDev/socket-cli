/**
 * Escape regular-expression syntax characters in a literal string.
 *
 * Escape hyphens too so this remains compatible with Unicode RegExp modes.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
}
