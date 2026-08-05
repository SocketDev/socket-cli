// Canonical honesty-filler matcher — the single source for every hook that
// flags "honest"/"honestly"/"honesty" framing. Before this, each carried its
// own divergent copy: reply-prose had the bare word ban, the conversational
// nudge only "to be honest", and the prose guard only the framing phrases — so
// the same concern fired inconsistently across surfaces.
//
// Consumed by anti-prose-guard (the ONLY enforcement path: PreToolUse on doc
// writes, and Stop on the chat reply via `CATEGORICAL_PROSE_BANS`) and
// convo-prose-nudge (PreToolUse, gh pr/issue bodies).
//
// NOT consumed by reply-prose-nudge, which this header claimed for months.
// That hook spreads `AI_SLOP_PATTERNS`, and that table only RE-EXPORTS the
// symbols below without listing the pattern — so the chat surface read as
// covered from two directions while nothing scanned it. anti-prose-guard's
// Stop path is the real coverage, and it in turn was missing `global: true`,
// so outside a fleet repo nothing scanned the reply at all. Both are fixed;
// the pairing is pinned by
// `scripts/fleet/check/categorical-prose-bans-are-live.mts`. Before adding a
// consumer to this list, confirm the pattern is in that consumer's SCANNED
// table, not merely importable from it.
//
// Coverage is the UNION of all three, deliberately categorical: the BARE word
// (`honest`/`honestly`/`honesty`) is banned outright, matching reply-prose's
// "always wrong" stance. The maintainer decided the word is filler framing —
// claiming honesty implies the rest is not — so a match is a verdict, not a
// heuristic. Word boundaries keep it off compounds (e.g. "honestcode"), and
// the per-surface bypass phrase covers the rare warranted adverbial use; that
// is why the bare ban is safe to share across all three surfaces without
// per-surface softening.

// Three branches, each an EXPLICIT word alternation — no compressed suffix
// tricks, no positional anchors that inflections or sentence position dodge:
//
//   1. honest / honestly / honesty — the categorical ban; subsumes every
//      framing phrase ("in all honesty", "to be honest", "if I'm honest",
//      "the honest <X>") since each carries one of the three tokens.
//   2. frankly — categorical for the same reason, wherever it sits in the
//      sentence ("Frankly, …", "quite frankly", "frankly speaking").
//   3. paper over in any inflection (paper/papers/papered/papering over) —
//      the self-defense framing with no honesty token.
export const HONESTY_FRAMING_RE =
  /\b(?:honest|honestly|honesty)\b|\bfrankly\b|\bpaper(?:ed|ing|s)?\s+over\b/i

// Shared label + rationale so consumers render one consistent message.
export const HONESTY_LABEL =
  'BANNED honesty framing — hard rule, this match is a VERDICT not a heuristic'

// The rationale, with NO variant list: the reporting surfaces print the exact
// matched token beside it, and reciting the whole banned vocabulary in every
// verdict re-injected those words into the reader's context for nothing.
export const HONESTY_WHY =
  'Claiming honesty implies the rest is not. State the fact, the limitation, or the recommendation plainly and delete the framing.'

// The exact token the matcher hit in `text`, or undefined when clean. Reports
// name ONLY this token, narrowing the verdict to what actually fired.
export function honestyFramingMatch(text: string): string | undefined {
  return HONESTY_FRAMING_RE.exec(text)?.[0]
}

// True when `text` carries any honesty-filler framing. HONESTY_FRAMING_RE has
// no /g flag, so `.test` is stateless across calls.
export function matchesHonestyFraming(text: string): boolean {
  return HONESTY_FRAMING_RE.test(text)
}
