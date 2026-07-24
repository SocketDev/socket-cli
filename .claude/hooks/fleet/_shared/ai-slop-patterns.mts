// Canonical AI-slop pattern table — the single source every prose guard imports
// so the same tells fire consistently on doc writes (anti-prose-guard), GitHub
// pr/issue bodies (convo-prose-nudge), and chat replies (reply-prose-nudge).
// Companion to _shared/honesty-framing.mts (the honest matcher); this re-exports
// it so a consumer gets one import point for the full slop set.
//
// Scope discipline: only NEAR-ZERO-FALSE-POSITIVE tells live here, because these
// gate real writes. Purple-prose words that never earn a place in fleet prose,
// and fixed slop phrasings. Tech-ambiguous words (robust, leverage, harness,
// utilize, streamline, foster, empower, realm, beacon) stay ADVISORY in the
// prose skill's references/phrases.md and are never blocked here. The full
// human-readable doctrine (with fixes) is that file; this is its enforceable
// subset.

export interface SlopPattern {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

export const AI_SLOP_PATTERNS: readonly SlopPattern[] = [
  {
    label: 'purple-prose word',
    // Two alternatives: a word-boundary-anchored set of single slop words
    // (delve / ever-evolving / supercharge / tapestry), or the fixed two-word
    // phrase "paradigm shift". Case-insensitive.
    regex:
      /\b(?:delve|ever-evolving|supercharge|tapestry)\b|\bparadigm shift\b/i,
    why: 'AI-slop word with no place in fleet prose. Use the plain word the sentence needs.',
  },
  {
    label: 'importance puffery',
    // One word-boundary-anchored alternation of fixed puffery phrases;
    // "solidifies its" accepts either "place" or "position". Case-insensitive.
    regex:
      /\b(?:marks a pivotal moment|plays a vital role|solidifies its (?:place|position)|stands as a testament|underscores its significance)\b/i,
    why: 'Importance puffery. State the fact and let the reader judge whether it matters.',
  },
  {
    label: 'weasel attribution',
    // One word-boundary-anchored alternation of fixed sourceless-attribution
    // phrases. Case-insensitive.
    regex:
      /\b(?:experts agree|industry reports suggest|studies show|widely regarded as)\b/i,
    why: 'Weasel attribution. Name the source or cut the claim; never invent one.',
  },
  {
    label: 'colon reveal',
    // "the best part" or "here's the kicker/best part", each immediately
    // followed by a colon (the reveal). Case-insensitive.
    regex: /\b(?:here's the (?:best part|kicker)|the best part):/i,
    why: 'Colon-reveal drama. Write a plain sentence; reserve colons for lists, labels, quotes.',
  },
  {
    label: 'faux-insight setup',
    // Two alternatives: "what most people/nobody get(s) wrong / tell(s) you"
    // (optional plural s), or the fixed phrase "the part everyone misses".
    regex:
      /\bwhat (?:most people|nobody) (?:gets? wrong|tells? you)\b|\bthe part everyone misses\b/i,
    why: 'Faux-insight flattery. Cut the setup and let the claim stand on its own.',
  },
  {
    label: 'summary-recap ending',
    // A recap opener (In conclusion / In summary / At the end of the day) at
    // the start of the content or of any line (leading whitespace allowed).
    regex: /(?:^|\n)\s*(?:At the end of the day|In conclusion|In summary)\b/i,
    why: 'Summary-recap ending. The reader was just there; end on the last concrete point or next action.',
  },
]

/**
 * Scan `content` for AI-slop tells. Returns the matched patterns (empty when
 * clean). Every regex is stateless (no /g), so `.test` is safe across calls.
 */
export function findAiSlop(content: string): SlopPattern[] {
  const hits: SlopPattern[] = []
  for (let i = 0, { length } = AI_SLOP_PATTERNS; i < length; i += 1) {
    const pattern = AI_SLOP_PATTERNS[i]!
    if (pattern.regex.test(content)) {
      hits.push(pattern)
    }
  }
  return hits
}

// One import point for the full slop set: the honest matcher lives in its own
// module (older, shared by more consumers) and is re-exported here.
export {
  HONESTY_FRAMING_RE,
  HONESTY_LABEL,
  HONESTY_WHY,
  matchesHonestyFraming,
} from './honesty-framing.mts'
