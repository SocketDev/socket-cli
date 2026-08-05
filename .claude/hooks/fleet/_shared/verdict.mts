/**
 * @file The typed hook-verdict line — ONE home for the severity glyphs so a
 *   hook composes its message by kind and the emoji can never drift by hand.
 *   Four kinds, matching the hook taxonomy (`hook-registry.md`) and
 *   socket-lib's logger symbols where one exists:
 *
 *   - `block` → 🚨 a -guard verdict; the tool call or turn-end is refused.
 *   - `warn` → ⚠️ something is off and deserves attention now.
 *   - `info` → ℹ️ a plain status notice.
 *   - `hint` → 💡 a tip: a better path exists, nothing is wrong — the default
 *     register for a -nudge. The line shape is the terse-verdict law: one line
 *     per hit, `<glyph> <hook-name>: <action> "<evidence>" — <fix>`.
 *     Continuation hits are indented evidence-only lines (see
 *     anti-prose-guard's Stop verdict, the exemplar).
 */

/**
 * The severity of one hook emission — which glyph opens the line.
 */
export type VerdictKind = 'block' | 'hint' | 'info' | 'warn'

/**
 * The glyph for a verdict kind. ⚠️ and ℹ️ carry the emoji-presentation
 * selector on purpose — the colored forms read at a glance in a terminal
 * transcript.
 */
export const VERDICT_GLYPHS: Readonly<Record<VerdictKind, string>> = {
  __proto__: null,
  block: '🚨',
  hint: '💡',
  info: 'ℹ️',
  warn: '⚠️',
} as Readonly<Record<VerdictKind, string>>

/**
 * Compose the one-line verdict: `<glyph> <hook-name>: <message>`. The
 * message carries action + quoted evidence + fix per the terse-verdict law;
 * this helper owns only the prefix so severity and name can never drift.
 */
export function verdictLine(
  kind: VerdictKind,
  hookName: string,
  message: string,
): string {
  return `${VERDICT_GLYPHS[kind]} ${hookName}: ${message}`
}

/**
 * An indented continuation line for the second and later hits of one
 * verdict — evidence only, aligned under the banner.
 */
export function verdictContinuation(message: string): string {
  return `   ${message}`
}
