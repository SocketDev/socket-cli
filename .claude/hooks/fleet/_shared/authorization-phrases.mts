/*
 * @file Single source of truth for KNOWN AUTHORIZATION PHRASES — the grant
 *   phrases a human types to lift a guard (the `Allow <slug> bypass` family
 *   from _shared/bypass.mts plus the push-protected grants). Shared by BOTH
 *   sides of the laundering defense so the lists can never drift:
 *
 *   - DETECTION side: push-protected-branch-guard (and any guard with bespoke
 *     phrases) imports its phrase list from here; the transcript scanner
 *     rejects non-human provenance (transcript.mts).
 *   - EMISSION side: authorization-phrase-emission-guard blocks an agent from
 *     EMITTING a phrase that would read as a grant — into a SendMessage
 *     payload, a Task/Agent prompt, or a file — using `findAuthorizationPhrase`
 *     below.
 *
 *   Doctrine (docs/agents.md/fleet/bypass-phrases.md): an authorization phrase
 *   is a HUMAN-ONLY artifact. Agents never request, relay, or emit one;
 *   blocked means report BLOCKED to the human and stop.
 */

import { normalizeBypassText } from './transcript.mts'

/**
 * The push-protected-branch-guard grant phrases. `Allow push to main` is the
 * spelling the deny message teaches; the `bypass`-suffixed forms match the
 * fleet's `Allow <X> bypass` convention. Imported by the guard (detection) and
 * folded into the emission patterns below.
 */
export const PROTECTED_PUSH_BYPASS_PHRASES = [
  'Allow push to main',
  'Allow push to master',
  'Allow push-to-protected bypass',
  'Allow protected-push bypass',
] as const

/**
 * Emission-side matchers, applied to `normalizeBypassText`-normalized text
 * (lowercased, dash/whitespace-folded — the same normal form the detection
 * scanner matches in, so what the emission guard blocks is exactly what the
 * detection side would accept):
 *
 * - The protected-push grants (`allow push to main|master`), and
 * - The whole `Allow <slug> bypass` family — matched by SHAPE, not by enumerating
 *   slugs, so a brand-new guard's phrase is covered the day it ships without
 *   touching this file. Bounded middle (1..6 words) keeps the match anchored to
 *   the canonical phrase shape.
 */
const EMISSION_PATTERNS: ReadonlyArray<{
  readonly label: string
  readonly re: RegExp
}> = [
  {
    label: 'a protected-push grant (Allow push to main/master)',
    re: /\ballow push to (?:main|master)\b/,
  },
  {
    label: 'a fleet bypass grant (Allow <slug> bypass)',
    re: /\ballow(?: [a-z0-9.@/:_]+){1,6} bypass\b/,
  },
]

/**
 * Does `text` carry a known authorization phrase? Returns a human-readable
 * label describing WHICH family matched (never the phrase itself — the block
 * message must not become a copy-paste source), or undefined when clean.
 * Matching runs on the normalized form, so case / dash / whitespace / newline
 * variants are all caught.
 */
export function findAuthorizationPhrase(text: string): string | undefined {
  if (!text) {
    return undefined
  }
  const normalized = normalizeBypassText(text)
  for (let i = 0, { length } = EMISSION_PATTERNS; i < length; i += 1) {
    const entry = EMISSION_PATTERNS[i]!
    if (entry.re.test(normalized)) {
      return entry.label
    }
  }
  return undefined
}
