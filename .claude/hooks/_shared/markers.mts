/**
 * @fileoverview Canonical opt-out marker handling shared across hooks.
 *
 * The fleet `// socket-hook: allow <rule>` marker has two surfaces:
 *
 *   1. `.claude/hooks/*-guard/index.mts` (PreToolUse hooks, Claude Code).
 *   2. `.git-hooks/_helpers.mts` (pre-commit / pre-push scanners).
 *
 * Both surfaces need the same regex, the same suppression check, and
 * the same alias map. Defining them in one place means a future
 * `RULE_ALIASES` addition can't silently diverge between the two — the
 * "Marker name was logger, now it's console" episode showed why
 * inline-duplicating the alias check is a footgun.
 */

// `<comment-prefix>` is `#`, `//`, or `/*` to match shell, JS/TS, and
// C-block comment lexers. The capture group catches the optional rule
// name (`socket-hook: allow personal-path` → `'personal-path'`); the
// bare form (`socket-hook: allow`) leaves capture undefined and means
// "blanket suppress every scanner on this line."
export const SOCKET_HOOK_MARKER_RE: RegExp =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

/**
 * Legacy marker names recognized as equivalent to a current rule for
 * one deprecation cycle. Keys are aliases; values are the canonical
 * rule name. The match is bidirectional in `aliasMatches` so callers
 * can ask either side.
 *
 * Add entries when renaming a rule. Drop them after one cycle.
 */
export const RULE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  __proto__: null,
  // `logger` was the original marker when the scanner only flagged
  // process.std{out,err}.write; renamed to `console` once console.*
  // entered scope. Keep the alias one cycle so existing markers in
  // downstream repos don't have to migrate atomically.
  logger: 'console',
} as Record<string, string>)

/**
 * True when `marker` and `rule` name the same logical rule, either
 * directly or via a `RULE_ALIASES` entry in either direction.
 */
export function aliasMatches(marker: string, rule: string): boolean {
  if (marker === rule) {
    return true
  }
  return RULE_ALIASES[marker] === rule || RULE_ALIASES[rule] === marker
}

/**
 * True when `line` carries a marker that suppresses `rule`. A bare
 * `socket-hook: allow` (no rule name) is treated as a blanket allow
 * and returns true for every `rule`.
 *
 * `rule === undefined` means "is any marker present at all" — used by
 * generic line-iteration helpers that don't carry a rule context.
 */
export function lineIsSuppressed(line: string, rule?: string): boolean {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  // No rule named on the marker → blanket allow.
  if (!m[1]) {
    return true
  }
  if (rule === undefined) {
    return true
  }
  return aliasMatches(m[1], rule)
}
