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

import {
  collapseIntraWordMarkup,
  decodeAsciiNumericEntities,
  normalizeForScan,
  stripCombiningMarks,
} from './evasion-normalize.mts'
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
 * Emission-side matchers. Both run on {@link normalizeForPhraseScan} output,
 * which contains the detection scanner's own normal form, so what this guard
 * blocks always covers what the detection side would accept.
 *
 * Two families: the protected-push grants, and the whole `Allow <slug> bypass`
 * family. The second is matched by SHAPE rather than by enumerating slugs, so
 * a brand-new guard's phrase is covered the day it ships without touching this
 * file.
 */
// require-regex-comment: the protected-push grant, matched whole because both
// its branch names are fixed.
const PROTECTED_PUSH_RE = /\ballow push to (?:main|master)\b/
const PROTECTED_PUSH_LABEL =
  'a protected-push grant (Allow push to main/master)'

const SLUG_BYPASS_LABEL = 'a fleet bypass grant (Allow <slug> bypass)'

/**
 * Widest gap between `allow` and `bypass` that still reads as one phrase.
 */
const MAX_MIDDLE_WORDS = 6

// require-regex-comment: trailing/leading punctuation on a token — the phrase
// legitimately ends `bypass:` or `bypass.`, and the word is what matters.
const TOKEN_EDGE_PUNCTUATION_RE = /^[^a-z0-9]+|[^a-z0-9]+$/g

/**
 * Function words that carry no slug meaning. A middle built ENTIRELY from
 * these is ordinary English — "allow you to bypass the guard" is a sentence
 * about the guard, not a grant. A real slug always contributes at least one
 * content word (`revert`, `force-push`, `workflow-scope`), and because
 * `normalizeBypassText` folds hyphens to spaces, that content word survives
 * whichever way the operator spells the slug.
 */
const MIDDLE_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'any',
  'anyone',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'from',
  'he',
  'her',
  'him',
  'his',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'no',
  'nor',
  'not',
  'of',
  'on',
  'or',
  'our',
  'she',
  'should',
  'so',
  'some',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'us',
  'was',
  'we',
  'were',
  'will',
  'with',
  'would',
  'you',
  'your',
])

/**
 * Is there an `allow … bypass` run whose last middle word carries slug
 * meaning? The word immediately before `bypass` is the discriminator: a real
 * grant ends its slug there (`… force-with-lease main bypass`), while prose
 * reaches `bypass` through a function word (`allow you TO bypass`,
 * `--allow-dirty TO bypass`, `allow a bypass`). Dash-folding makes
 * `force-with-lease` and `force with lease` the same run, so the check holds
 * however the operator spells the slug.
 *
 * Every `allow`/`bypass` pairing is examined, not just the widest — two
 * `bypass` occurrences in one sentence must not let a prose pairing mask a
 * real one.
 */
function hasSlugBypassGrant(normalized: string): boolean {
  const tokens = normalized
    .split(' ')
    .map(token => token.replace(TOKEN_EDGE_PUNCTUATION_RE, ''))
    .filter(Boolean)
  for (let i = 0, { length } = tokens; i < length; i += 1) {
    if (tokens[i] !== 'allow') {
      continue
    }
    const last = Math.min(i + MAX_MIDDLE_WORDS + 1, length - 1)
    for (let j = i + 2; j <= last; j += 1) {
      if (tokens[j] === 'bypass' && !MIDDLE_STOPWORDS.has(tokens[j - 1]!)) {
        return true
      }
    }
  }
  return false
}

/**
 * The normal form both emission patterns match in. Layered deliberately —
 * each pass answers "would the surface a human reads render this AS the
 * phrase?", and nothing broader:
 *
 * 1. Numeric HTML references → the letter they render as,
 * 2. Markup that splits a word → removed,
 * 3. `normalizeBypassText` → NFKC, format/zero-width strip, dash + whitespace
 *    fold, lowercase (the SAME normal form the detection scanner accepts in, so
 *    emission can never lag detection),
 * 4. Combining marks → dropped,
 * 5. Confusable letters → folded to ASCII.
 *
 * Not folded, on purpose: base64 and percent-encoding (no human-facing
 * surface renders either as text, and decoding every base64-shaped run would
 * fire on hashes and tokens), and intra-word `_` (CommonMark forbids
 * `A_llow_` from rendering as emphasis, so it stays visibly broken).
 */
export function normalizeForPhraseScan(text: string): string {
  return normalizeForScan(
    stripCombiningMarks(
      normalizeBypassText(
        collapseIntraWordMarkup(decodeAsciiNumericEntities(text)),
      ),
    ),
  )
}

/**
 * Does `text` carry a known authorization phrase? Returns a human-readable
 * label describing WHICH family matched (never the phrase itself — the block
 * message must not become a copy-paste source), or undefined when clean.
 */
export function findAuthorizationPhrase(text: string): string | undefined {
  if (!text) {
    return undefined
  }
  const normalized = normalizeForPhraseScan(text)
  if (PROTECTED_PUSH_RE.test(normalized)) {
    return PROTECTED_PUSH_LABEL
  }
  return hasSlugBypassGrant(normalized) ? SLUG_BYPASS_LABEL : undefined
}
