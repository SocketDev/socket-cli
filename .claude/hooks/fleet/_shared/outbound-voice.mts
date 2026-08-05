/**
 * @file The fleet's single definition of "off-voice outbound prose" — the
 *   owner's banned words plus the AI tells that survive a slop pass. Sibling of
 *   `_shared/ai-attribution.mts`: same structured-list-plus-derived-regex
 *   shape, same gate-free discipline, and the same reason for existing — one
 *   catalog so a phrase flagged on one outbound surface cannot pass on another.
 *   SCOPE, and why this is not folded into `_shared/ai-slop-patterns.mts`: that
 *   module gates a BLOCKING write guard (`anti-prose-guard`, on CHANGELOG /
 *   docs / README), so it admits only near-zero-false-positive tells. The
 *   banned words here are ordinary technical English — "pinned" is what the
 *   fleet's own SHA-pinning prose calls the thing — and banning them at a write
 *   gate would block correct documentation. They are a VOICE preference on
 *   OUTBOUND prose (PRs, issues, tracker comments, chat messages), enforced
 *   warn-only, so they live in their own catalog with their own consumers. Two
 *   matchers, because outbound surfaces divide into two classes:
 *   `findVoiceSlop` is the voice catalog alone, and runs on EVERY outbound
 *   surface. `findUncoveredProseSlop` adds the shared canonical slop set
 *   (`ai-slop-patterns.mts` + the honesty matcher) and runs ONLY on surfaces no
 *   other hook watches — the MCP trackers and chat. The `gh` path deliberately
 *   skips it: `convo-prose-nudge` already reports that exact set for PR/issue
 *   bodies, and firing both would print every hit twice. GATE-FREE on purpose:
 *   no imports outside sibling `_shared` modules and no Node-version hard-exit,
 *   so the git-hook tier and the user-global dispatcher can load it on whatever
 *   Node the operator has.
 */

import { AI_SLOP_PATTERNS } from './ai-slop-patterns.mts'
import {
  HONESTY_LABEL,
  HONESTY_WHY,
  honestyFramingMatch,
} from './honesty-framing.mts'

/**
 * Why a phrase is off-voice. `banned-word` is the owner's standing word ban — a
 * match is a verdict. `ai-tell` is a phrasing that reads machine-written; a
 * match is a strong heuristic. Consumers render the two differently, so the
 * distinction has to survive into the hit.
 */
export type VoiceSlopKind = 'ai-tell' | 'banned-word'

/**
 * One off-voice phrase: the `term` a message names, the `regex` that spots it,
 * the `kind` that says how hard the rule is, and the `why` a nudge shows.
 */
export interface VoicePattern {
  readonly kind: VoiceSlopKind
  readonly regex: RegExp
  readonly term: string
  readonly why: string
}

/**
 * The voice catalog. Every entry is word-boundary anchored and
 * case-insensitive.
 *
 * The two banned words are anchored NARROWLY, to the exact tokens the owner
 * banned and nothing adjacent: `\bpinned\b` leaves "unpinned", "pinning", and
 * "pin" alone, and `\bseams?\b` leaves "seamless" and "seamstress" alone.
 * Negative tests hold both — widening either to catch a derivative would flag
 * ordinary technical prose, which is how a warn-only nudge earns being ignored.
 *
 * The AI-tell list stays SHORT and literal: each entry is a fixed phrasing with
 * no legitimate use in fleet outbound prose. Tells the shared canonical
 * catalogs already carry are deliberately ABSENT — "delve" and the purple-prose
 * set are in `ai-slop-patterns.mts`, every "honest" form is in
 * `honesty-framing.mts`, "Hope this helps" and the throat-clearing openers are
 * in `convo-prose-nudge`. Re-listing one here would rebuild the exact drift the
 * AI-attribution consolidation removed.
 */
export const VOICE_SLOP_PATTERNS: readonly VoicePattern[] = [
  {
    kind: 'banned-word',
    regex: /\bpinned\b/i,
    term: 'pinned',
    why: 'Banned word. Say what actually holds the value: "the lockfile records", "the workflow references SHA <x>", "the test asserts".',
  },
  {
    kind: 'banned-word',
    regex: /\bseams?\b/i,
    term: 'seam',
    why: 'Banned word. Name the real thing: the boundary, the interface, the callsite, the hand-off.',
  },
  {
    kind: 'ai-tell',
    // "in today's fast-paced" — the straight and curly apostrophe both, since a
    // body pasted from a rich-text editor carries the curly one.
    regex: /\bin today['’]s fast-paced\b/i,
    term: "in today's fast-paced",
    why: 'Marketing throat-clearing. Delete the preamble and open on the fact.',
  },
  {
    kind: 'ai-tell',
    regex: /\bit['’]s important to note\b/i,
    term: "it's important to note",
    why: 'Importance label. If it matters, state it; the reader decides what is important.',
  },
  {
    kind: 'ai-tell',
    regex: /\brest assured\b/i,
    term: 'rest assured',
    why: 'Reassurance filler. Give the evidence that earns the confidence instead.',
  },
  {
    kind: 'ai-tell',
    // The first-person closing form. Bare "Hope this helps" is already
    // convo-prose-nudge's on the `gh` surface; this catches the "I hope …"
    // spelling on every surface, including the MCP trackers it never saw.
    regex: /\bI hope this helps\b/i,
    term: 'I hope this helps',
    why: 'Closing filler. End on the last concrete point or the next action.',
  },
]

/**
 * The whole-text voice matcher, built FROM `VOICE_SLOP_PATTERNS` so the catalog
 * and the combined regex cannot drift apart — the property the AI-attribution
 * module settled on for the same reason. Case-insensitive and multiline. No `g`
 * flag: a global regex carries `lastIndex` between `.test()` calls and would
 * skip matches.
 */
export const VOICE_SLOP_RE: RegExp = new RegExp(
  VOICE_SLOP_PATTERNS.map(pattern => `(?:${pattern.regex.source})`).join('|'),
  'im',
)

/**
 * One off-voice hit: the pattern that fired, flattened to what a message needs.
 */
export interface VoiceSlopHit {
  readonly kind: VoiceSlopKind
  // The exact token that fired, so reports name what to delete instead of
  // reciting the pattern's variant list.
  readonly match: string
  readonly term: string
  readonly why: string
}

/**
 * Every voice-catalog phrase present in `text`, in catalog order. Empty means
 * clean. Each regex is stateless (no `/g`), so `.test` is safe across calls.
 */
export function findVoiceSlop(text: string): VoiceSlopHit[] {
  const hits: VoiceSlopHit[] = []
  for (let i = 0, { length } = VOICE_SLOP_PATTERNS; i < length; i += 1) {
    const pattern = VOICE_SLOP_PATTERNS[i]!
    const match = pattern.regex.exec(text)
    if (match) {
      hits.push({
        kind: pattern.kind,
        match: match[0],
        term: pattern.term,
        why: pattern.why,
      })
    }
  }
  return hits
}

/**
 * True when `text` carries any voice-catalog phrase. The cheap question, for a
 * caller that only needs to decide whether to build a message.
 */
export function containsVoiceSlop(text: string): boolean {
  return VOICE_SLOP_RE.test(text)
}

/**
 * The shared canonical slop set — `ai-slop-patterns.mts` plus the honesty
 * matcher — reported in the same hit shape as the voice catalog.
 *
 * For surfaces with NO existing prose hook. The MCP trackers and chat (Linear,
 * Notion, Slack) are outbound human-facing prose that nothing watched before
 * this module: `anti-prose-guard` covers doc writes, `convo-prose-nudge` covers
 * `gh` bodies, `reply-prose-nudge` covers the chat reply. Callers on the `gh`
 * path must NOT call this — `convo-prose-nudge` reports the same set there.
 *
 * Reads the canonical catalogs rather than restating them, so a tell added to
 * either one reaches the MCP surfaces with no edit here.
 */
export function findUncoveredProseSlop(text: string): VoiceSlopHit[] {
  const hits: VoiceSlopHit[] = []
  for (let i = 0, { length } = AI_SLOP_PATTERNS; i < length; i += 1) {
    const pattern = AI_SLOP_PATTERNS[i]!
    const match = pattern.regex.exec(text)
    if (match) {
      hits.push({
        kind: 'ai-tell',
        match: match[0],
        term: pattern.label,
        why: pattern.why,
      })
    }
  }
  const honestyMatch = honestyFramingMatch(text)
  if (honestyMatch !== undefined) {
    hits.push({
      kind: 'banned-word',
      match: honestyMatch,
      term: HONESTY_LABEL,
      why: HONESTY_WHY,
    })
  }
  return hits
}
