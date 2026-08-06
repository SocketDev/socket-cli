// Prose-antipattern detection patterns for anti-prose-guard.
//
// Split out from index.mts so tests can import the pattern table without
// triggering the hook's top-level `await withEditGuard(...)` (which blocks
// reading stdin). The hook's index.mts and its unit test both import
// PROSE_PATTERNS from here.

import { AI_SLOP_PATTERNS } from '../_shared/ai-slop-patterns.mts'
import {
  HONESTY_FRAMING_RE,
  HONESTY_LABEL,
  HONESTY_WHY,
} from '../_shared/honesty-framing.mts'
import { HEADING_LISTY_ASIDE_RE } from '../_shared/trailing-aside.mts'
import { stripAllCodeSpans } from '../_shared/transcript.mts'

export interface ProsePattern {
  // Scan a copy with fenced blocks and EVERY inline span removed, so a
  // character quoted as CODE never fires. Opt-in per pattern, because the
  // default must not exempt inline spans: wrapping a banned phrase in
  // backticks is the cheap dodge the Stop surface exists to close. It is set
  // only where the banned character is legitimately part of quoted code, which
  // today is the em-dash: `_shared/verdict.mts` documents the verdict line the
  // hooks actually emit, dash included, inside a code span, and "fixing" that
  // dash would change hook OUTPUT rather than prose.
  readonly codeExempt?: boolean | undefined
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

// A resolved match: the pattern plus the exact token that fired. Reporting
// surfaces print the token so the verdict names what to delete instead of
// reciting a variant list.
export interface ProseHit {
  readonly label: string
  readonly match: string
  readonly why: string
}

/**
 * The CATEGORICAL tier: patterns that are a VERDICT on any surface, never a
 * heuristic. Every other entry in `PROSE_PATTERNS` can over-fire on a
 * legitimate sentence, which is why they only gate a doc write the author can
 * reword and retry. These cannot: the word itself is the defect. That is what
 * makes them safe to enforce on the REPLY too, where there is no retry loop
 * and no file to inspect.
 *
 * The honesty family is the founding member. Claiming honesty implies the rest
 * is not — see `_shared/honesty-framing.mts`, the single source this and
 * `convo-prose-nudge` both consume.
 */
export const CATEGORICAL_PROSE_BANS: readonly ProsePattern[] = [
  {
    label: HONESTY_LABEL,
    // The honesty matcher is the shared _shared/honesty-framing.mts source —
    // meta-commentary on one's own candor ("to be honest", "honestly", the
    // framing phrases) plus the "papered over" self-defense. State the fact;
    // the honesty is assumed, not announced.
    regex: HONESTY_FRAMING_RE,
    why: HONESTY_WHY,
  },
  {
    label: 'truth intensifier',
    // Asserting that THIS claim is the real one implies the neighbours are
    // approximate. Measured over 3 months of transcripts: `genuinely` 36,970
    // hits, `the actual <noun>` 46,359. `the actual` is scoped to the crutch
    // collocations, so a real measurement ("the actual byte count was 4,096")
    // still passes.
    //
    // CATEGORICAL, not heuristic. Its own rationale always said "same defect as
    // claiming one's own truthfulness, already banned above" while it sat in
    // the tier BELOW that ban — so it gated doc writes and was never scanned on
    // a reply, and `genuinely` shipped twice in one message arguing the fleet's
    // own voice rules. Every branch is deletable filler: removing the word
    // strengthens the sentence, which is the test for verdict-grade.
    regex:
      /\b(?:genuinely|let me be clear|precisely the|the actual (?:behavior|behaviour|cause|defect|failure|issue|problem|reason|shape|state)|to be clear)\b/i,
    why: 'Truth intensifiers claim reliability instead of showing it. Delete the word and let the evidence carry the sentence.',
  },
  {
    label: 'self-labeling frame',
    // Announcing the REGISTER of what follows ("the honest version", "the short
    // version") instead of just writing in it. The honesty spellings already
    // fall to HONESTY_FRAMING_RE above; this catches the same move in its other
    // adjectives, where the defect is identical — a label that grades the
    // sentence it introduces, and implies the surrounding text is the unlabeled
    // opposite. Scoped to the four register nouns so "the short list" (an
    // ordinary use) does not fire. `real` is deliberately ABSENT: "the real
    // answer" already belongs to the contrast-scaffolding row below, and
    // repeating it here would both double-report and quietly promote that
    // heuristic to blocking through the back door.
    regex:
      /\bthe\s+(?:blunt|candid|honest|plain|short|straight|unvarnished)\s+(?:answer|story|truth|version)\b/i,
    why: 'A register label grades the sentence instead of writing it. Delete the label and state the thing.',
  },
]

export const PROSE_PATTERNS: readonly ProsePattern[] = [
  // The categorical bans gate doc writes alongside the heuristics; the Stop
  // surface scans this tier ALONE, because only these are verdict-grade.
  ...CATEGORICAL_PROSE_BANS,
  {
    codeExempt: true,
    label: 'em-dash',
    // ANY U+2014, not merely a chain. The rule tightened on 2026-08-05: on an
    // outbound GitHub surface one em-dash already reads as an agent tell, and
    // allowing a single dash left every doc one edit away from a chain. The
    // gate-time twin is scripts/fleet/check/prose-em-dashes-are-absent.mts,
    // which carries the corpus burn-down list.
    regex: /—/,
    why: 'An em-dash reads AI-generated, even one. Replace it with a plain hyphen and keep the spacing: ` — ` becomes ` - `.',
  },
  {
    label: 'value inflation',
    // Editorializing that one thing is worth more than another, or that an
    // effort repaid itself. It grades the work instead of reporting it, and the
    // comparison is always the writer's opinion dressed as a finding. State
    // what was found and let the reader weigh it.
    regex:
      /\b(?:earned its keep|earns its keep|if nothing else|more valuable than|paid for itself|pays for itself|the real (?:prize|value|win)|worth more than)\b/i,
    why: 'Value inflation grades the work instead of reporting it. Drop the comparison and state the finding plainly.',
  },
  {
    label: 'significance marker',
    // Ranking the content for the reader instead of reporting it. If a finding
    // needs `crucially` to land, the finding is underwritten.
    regex:
      /\b(?:crucially|importantly|notably|the key insight|the whole point is|what matters here)\b/i,
    why: 'Significance markers rank the content for the reader. State the finding; its weight should be self-evident.',
  },
  {
    label: 'recycled jargon',
    // House metaphors reached for in place of describing the mechanism. Each
    // names a category instead of the specific thing that breaks. Measured:
    // `load-bearing` 11,603 hits, `by construction` 3,509.
    regex:
      /\b(?:by construction|load-bearing|the (?:exact|failure|same) shape|the tell)\b/i,
    why: 'Recycled jargon names a category instead of the mechanism. Say what specifically breaks, and how.',
  },
  {
    label: 'contrast scaffolding',
    // The banned "not X, it's Y" shape in another spelling: build a foil, then
    // knock it down. Measured: `the real <noun>` ~12,600 hits. The value/win/
    // prize spellings belong to value inflation above.
    regex: /\bthe real (?:answer|issue|problem|question)\b/i,
    why: 'Contrast scaffolding erects a foil to knock down. State the positive finding directly.',
  },
  {
    label: 'throat-clearing opener',
    regex:
      /^\s*(?:Here's the thing|I should note|It's worth noting|Let me)\b/im,
    why: 'Throat-clearing preamble. Open on the substance, drop the warm-up.',
  },
  {
    label: '"not X, it\'s Y" contrast',
    regex: /\bnot\s+\w+[,.]?\s+(?:but rather|it is|it's)\b/i,
    why: 'The "not X, it\'s Y" reversal is an AI-prose tic. State the point directly.',
  },
  {
    label: 'hedging adverb',
    regex: /\b(?:basically|essentially|fundamentally|just|simply)\b/i,
    why: 'Vague hedging adverb doing no work. Cut it or replace with the concrete fact.',
  },
  {
    label: 'heading trailing parenthetical aside',
    // Shares the value-level "extra bits" detector's source
    // (_shared/trailing-aside.mts) so a heading and a manifest description are
    // judged by one matcher. Fires on a listy trailing parenthetical.
    regex: HEADING_LISTY_ASIDE_RE,
    why: 'Heading ends with a listy parenthetical aside. State the heading plainly; move the "(a, b, c)" tail into the body.',
  },
  // The no-ai-slop tells (purple-prose words, importance puffery, weasel
  // attribution, colon reveals, faux-insight, summary-recap) are the shared
  // _shared/ai-slop-patterns.mts source, so every prose surface flags them.
  ...AI_SLOP_PATTERNS,
]

/**
 * Every pattern in `patterns` whose regex matches `content`, in table order.
 * The one scan loop all three finders share.
 */
export function matchProsePatterns(
  content: string,
  patterns: readonly ProsePattern[],
): ProseHit[] {
  const hits: ProseHit[] = []
  // Built once, and only when a `codeExempt` pattern is actually reached, so
  // the common all-prose table costs nothing.
  let prose: string | undefined
  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const pattern = patterns[i]!
    let subject = content
    if (pattern.codeExempt) {
      prose ??= stripAllCodeSpans(content)
      subject = prose
    }
    const match = pattern.regex.exec(subject)
    if (match) {
      hits.push({ label: pattern.label, match: match[0], why: pattern.why })
    }
  }
  return hits
}

/**
 * One categorical-ban hit with its evidence: the exact matched text and a
 * short surrounding snippet, so a verdict can point at the offending words
 * instead of lecturing doctrine.
 */
export interface ProseBanHit {
  readonly label: string
  readonly matched: string
  readonly snippet: string
}

/**
 * Scan `content` for the categorical bans and return each hit WITH its
 * matched text + a one-line context snippet. The Stop verdict renders these
 * tersely; the edit-time surfaces keep the fuller `why` from the pattern.
 */
export function findCategoricalProseBanHits(content: string): ProseBanHit[] {
  const hits: ProseBanHit[] = []
  for (let i = 0, { length } = CATEGORICAL_PROSE_BANS; i < length; i += 1) {
    const pattern = CATEGORICAL_PROSE_BANS[i]!
    const match = pattern.regex.exec(content)
    if (match) {
      const start = Math.max(0, match.index - 28)
      const end = Math.min(content.length, match.index + match[0].length + 28)
      hits.push({
        label: pattern.label,
        matched: match[0],
        snippet: content.slice(start, end).replaceAll(/\s+/g, ' ').trim(),
      })
    }
  }
  return hits
}

/**
 * Scan `content` for prose antipatterns. Returns the matched patterns (empty
 * when clean).
 */
export function findProseAntipatterns(content: string): ProseHit[] {
  return matchProsePatterns(content, PROSE_PATTERNS)
}

/**
 * Scan `content` for the CATEGORICAL bans only — the verdict-grade tier, with
 * every over-firing heuristic left out. What the Stop surface runs against a
 * chat reply.
 */
export function findCategoricalProseBans(content: string): ProseHit[] {
  return matchProsePatterns(content, CATEGORICAL_PROSE_BANS)
}

// CHANGELOG-only antipatterns: a changelog states user-visible behavior
// (the API or commands that changed), never the implementation that
// delivered it. Dependency bumps, internal mechanism names, and
// "resolved by upgrading X" tails are noise to a reader who just wants to
// know what changed for them. Scoped to CHANGELOG.md by the caller.
export const CHANGELOG_IMPL_PATTERNS: readonly ProsePattern[] = [
  {
    label: 'dependency mention',
    // Scoped package names + the words deps carry. A user-facing entry
    // describes behavior, not which library moved.
    regex:
      /@[a-z0-9-]+\/[a-z0-9-]+|\bdependenc(?:ies|y)\b|\blockfile\b|\btransitive\b/i,
    why: 'Dependency/lockfile mention — implementation detail. Describe the user-visible behavior that changed, not which package moved.',
  },
  {
    label: 'version-bump phrasing',
    // Matches "bumped/upgraded/pinned … to v1.2" — implementation-detail version deltas.
    regex:
      /\b(?:bump(?:ed|ing|s)?|pin(?:ned)?|upgrad(?:e|ed|ing))\b[^\n]*\bto\b\s*v?\d+\.\d+/i,
    why: 'Version-bump phrasing — implementation detail. State what the user can now do or what stopped breaking, not the version delta.',
  },
  {
    label: '"resolved by" / mechanism tail',
    // Matches "resolved by", "fixed by upgrading/bumping/pinning", or "by upgrading/bumping/pinning".
    regex:
      /\bresolved by\b|\bfixed by (?:bump|pin|upgrad)|\bby (?:bump|pin|upgrad)/i,
    why: 'The "resolved by upgrading X" tail explains the how. Cut it — the reader cares what changed, not the mechanism.',
  },
  {
    label: 'internal mechanism token',
    // Wire/transport/internal-API tokens that surface the plumbing rather
    // than the observable behavior.
    regex:
      /\b(?:OIDC|brotli|content-encoding|decodeBody|gzip|httpRequest|job_workflow_ref|reusable workflow)\b/i,
    why: 'Internal mechanism token — implementation detail. Describe the observable outcome, not the plumbing.',
  },
]

/**
 * Scan a CHANGELOG `content` block for implementation-detail antipatterns.
 * Returns the matched patterns, empty when clean. Caller restricts this to
 * CHANGELOG.md writes.
 */
export function findChangelogImplDetail(content: string): ProseHit[] {
  return matchProsePatterns(content, CHANGELOG_IMPL_PATTERNS)
}
