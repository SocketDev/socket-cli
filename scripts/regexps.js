'use strict'

// Inlined "escape-string-regexp":
// https://www.npmjs.com/package/escape-string-regexp/v/5.0.0
// MIT Licenced
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
function escapeRegExp(str) {
  // Escape characters with special meaning either inside or outside character sets.
  // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when
  // the simpler form would be disallowed by Unicode patterns’ stricter grammar.
  return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d')
}

module.exports = {
  escapeRegExp
}
