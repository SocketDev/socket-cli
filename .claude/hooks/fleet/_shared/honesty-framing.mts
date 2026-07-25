// Canonical honesty-filler matcher — the single source for every hook that
// flags "honest"/"honestly"/"honesty" framing. Consumed by reply-prose-nudge
// (Stop, chat voice), convo-prose-nudge (PreToolUse, gh pr/issue
// bodies), and anti-prose-guard (PreToolUse, doc writes). Before this,
// each carried its own divergent copy: reply-prose had the bare word ban, the
// conversational nudge only "to be honest", and the prose guard only the
// framing phrases — so the same concern fired inconsistently across surfaces.
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

export const HONESTY_WHY =
  'Remove the word — honest / honestly / honesty / "in all honesty" / "to be honest" / "Frankly,". Claiming honesty implies the rest is not. State the fact, the limitation, or the recommendation plainly and delete the framing.'

// True when `text` carries any honesty-filler framing. HONESTY_FRAMING_RE has
// no /g flag, so `.test` is stateless across calls.
export function matchesHonestyFraming(text: string): boolean {
  return HONESTY_FRAMING_RE.test(text)
}
