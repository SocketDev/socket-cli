/**
 * @fileoverview Shared helper for Bash-tool PreToolUse hooks.
 *
 * Hooks that inspect tool_input.command for a forbidden substring
 * (e.g. a destructive verb, a stale flag, a secret pattern) all face
 * the same false-positive risk: the match might fall inside a quoted
 * string body (`echo "tip: drop --bad-flag from your script"`) or
 * inside a heredoc that the shell will pass as literal text rather
 * than execute. This module centralizes the parsing so each hook can
 * reason in terms of "did the forbidden token appear as a real
 * argument" rather than "does the string contain this text."
 *
 * Two-level API:
 *
 *   buildQuoteMask(s) — per-character boolean array; mask[i] === true
 *     when the character at index i sits inside a single- or
 *     double-quoted string. Use this when you need to check a regex
 *     match's index against quote state.
 *
 *   matchOutsideQuotes(s, re) — convenience: run a regex against `s`
 *     and return the first match whose index sits OUTSIDE all quotes
 *     and outside any heredoc body. Returns undefined when every
 *     match is inside quoted/heredoc text. Use this for the common
 *     "does the live command contain this flag" check.
 *
 * Limitations:
 *
 *   - Not a full POSIX shell parser. Quote nesting (`$"..."`,
 *     `$'...'` ANSI-C) and `$(...)` command substitution are not
 *     tracked precisely; they fall through to the simple quote
 *     state. In practice this is fine for the use cases here, which
 *     all match a literal flag/verb that wouldn't appear inside
 *     parameter expansion.
 *
 *   - Heredoc detection looks for `<<DELIM ... \nDELIM\b` patterns.
 *     The delimiter is captured from the opening line and matched on
 *     a later line at column 0. Both `<<EOF` and `<<-EOF` (tab-stripped)
 *     forms are recognized; quoted delimiters (`<<'EOF'`) are also
 *     accepted.
 */

/**
 * Per-character mask: true at positions inside a single- or double-
 * quoted string. The opening and closing quote characters themselves
 * are marked true (so they're treated as "inside" — handy for code
 * that wants to skip both the quotes and the body).
 */
export function buildQuoteMask(s: string): boolean[] {
  const mask = new Array<boolean>(s.length).fill(false)
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]
    if (!inSingle && !inDouble && c === "'") {
      inSingle = true
      mask[i] = true
      continue
    }
    if (inSingle && c === "'") {
      inSingle = false
      mask[i] = true
      continue
    }
    if (!inSingle && !inDouble && c === '"') {
      inDouble = true
      mask[i] = true
      continue
    }
    if (inDouble && c === '"') {
      inDouble = false
      mask[i] = true
      continue
    }
    // Backslash escape inside double quotes: skip the escaped char.
    // (Single quotes don't honor backslash in POSIX, so we only
    // handle the double-quote case.)
    if (inDouble && c === '\\' && i + 1 < s.length) {
      mask[i] = true
      mask[i + 1] = true
      i += 1
      continue
    }
    mask[i] = inSingle || inDouble
  }
  return mask
}

/**
 * Replace heredoc bodies with empty strings of equivalent length so
 * the surrounding indices stay valid. Recognizes:
 *   <<EOF ... \nEOF
 *   <<-EOF ... \nEOF       (tab-stripped form)
 *   <<'EOF' ... \nEOF      (quoted delimiter, no interpolation)
 *   <<"EOF" ... \nEOF
 *
 * The closing delimiter must appear at column 0 (POSIX), but we
 * accept any leading whitespace as a small concession to the
 * tab-stripped `<<-` form.
 */
export function stripHeredocBodies(s: string): string {
  return s.replace(
    /<<-?\s*['"]?(\w+)['"]?([\s\S]*?)\n\s*\1\b/g,
    (full, _delim, body) => {
      // Replace the body with spaces so indices in the outer string
      // stay aligned. The opening line + delimiter line are kept so
      // callers can still see the `<<EOF` token if they care.
      return full.replace(body, ' '.repeat(body.length))
    },
  )
}

/**
 * Search `s` for the first regex match whose index falls outside
 * every single-/double-quoted string AND outside every heredoc body.
 * Returns the match, or undefined if every match was inside quoted
 * or heredoc text.
 *
 * The regex is run with the `g` flag implicitly — pass a non-global
 * regex and we'll create a global clone so `.exec()` can iterate.
 */
export function matchOutsideQuotes(
  s: string,
  pattern: RegExp,
): RegExpExecArray | undefined {
  const stripped = stripHeredocBodies(s)
  const mask = buildQuoteMask(stripped)
  const re = pattern.global
    ? pattern
    : new RegExp(pattern.source, pattern.flags + 'g')
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(stripped)) !== null) {
    if (!mask[match.index]) {
      return match
    }
    if (match.index === re.lastIndex) {
      re.lastIndex += 1
    }
  }
  return undefined
}

/**
 * Convenience predicate: true when `pattern` matches `s` at an
 * unquoted, non-heredoc position. Wraps matchOutsideQuotes.
 */
export function containsOutsideQuotes(s: string, pattern: RegExp): boolean {
  return matchOutsideQuotes(s, pattern) !== undefined
}
