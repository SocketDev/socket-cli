/*
 * @file Single source of truth for hook bypass PHRASES. A guard declares its
 *   bypass slug(s) once as `bypass: [...]` metadata (see defineHook); this
 *   module turns that one array into (a) the canonical phrase strings the
 *   detector matches and (b) the uniform footer the block message shows — so the
 *   phrase a guard PROMPTS is provably the phrase the detector ACCEPTS. The
 *   point of the DRY: a guard can never forget to surface its bypass, and the
 *   agent always knows exactly what to tell the user to type.
 *
 *   Canonical format: `Allow <slug> bypass`. A targeted bypass adds a target:
 *   `Allow <slug> bypass: <target>`. Matching (normalizeBypassText +
 *   phrasePattern in transcript.mts) is case-insensitive and tolerant of the
 *   slug's separator (hyphen / space / joined), of whitespace on both sides of
 *   the `:` target separator, and of newlines (folded to spaces) — so the user
 *   can type the phrase however is natural.
 */

import { joinOr } from '@socketsecurity/lib-stable/arrays/join'

// The fixed wrapper every bypass phrase carries. A slug fills the middle.
const BYPASS_PREFIX = 'Allow'
const BYPASS_SUFFIX = 'bypass'

/**
 * Turn bypass slug(s) into their canonical phrase strings.
 * `['nested-gitignore']` → `['Allow nested-gitignore bypass']`. The display
 * spelling uses the slug verbatim; the matcher folds separators/case so any
 * spelling the user types still matches.
 */
export function bypassPhrasesFor(slugs: readonly string[]): string[] {
  return slugs.map(slug => `${BYPASS_PREFIX} ${slug} ${BYPASS_SUFFIX}`)
}

/**
 * The uniform footer appended to every auto-bypass block message. Lists the
 * accepted phrase(s) with `joinOr` ("`A`" or "`A` or `B`") so a multi-phrase
 * guard reads naturally. This is the ONE place the bypass instruction is
 * worded, so every guard prompts it identically.
 */
export function bypassFooter(phrases: readonly string[]): string {
  const quoted = phrases.map(p => `\`${p}\``)
  return `Bypass (the user must type verbatim in a recent turn): ${joinOr(quoted)}`
}
