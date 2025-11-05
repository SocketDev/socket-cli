/**
 * @fileoverview Regular expression utilities including escape-string-regexp implementation.
 * Provides regex escaping and pattern matching helpers.
 */

// Inlined escape-string-regexp:
// https://socket.dev/npm/package/escape-string-regexp/overview/5.0.0
// MIT License
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

/**
 * Escape special characters in a string for use in a regular expression.
 */
/*@__NO_SIDE_EFFECTS__*/
export function escapeRegExp(str: string): string {
  // Escape characters with special meaning either inside or outside character sets.
  // Use a simple backslash escape when it's always valid, and a `\xnn` escape when
  // the simpler form would be disallowed by Unicode patterns' stricter grammar.
  return str.replace(/[\\|{}()[\]^$+*?.]/g, '\\$&')
}
