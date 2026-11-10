/**
 * Escape regular-expression syntax characters in a literal string.
 *
 * Copied narrowly from `@socketsecurity/registry` 1.1.17
 * (`registry/lib/regexps.js`, MIT) for Socket CLI ownership. Keep the upstream
 * behavior for hyphens so this remains compatible with Unicode RegExp modes.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
}
