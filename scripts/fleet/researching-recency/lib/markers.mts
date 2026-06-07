/**
 * @file Output-contract marker constants — the single source of truth for the
 *   literal strings the engine emits and the SKILL.md prose quotes. The
 *   contract check (`researching-recency-contract-is-current.mts`) imports these
 *   and asserts the SKILL.md body still quotes them verbatim, so the prose
 *   contract can't silently drift from the engine. render/ imports these too;
 *   nothing else should hard-code the strings.
 */

// Engine version. The badge embeds it; bump when the output contract changes.
export const ENGINE_VERSION = '1'

// First line of every compact emit: `📚 researching-recency v1 · synced <date>`.
// The model passes this through verbatim as the brief's first line.
export const BADGE_PREFIX = `📚 researching-recency v${ENGINE_VERSION}`

// The evidence the model reads and transforms into prose. Bounded so the model
// knows exactly what NOT to dump verbatim.
export const EVIDENCE_OPEN = '<!-- EVIDENCE FOR SYNTHESIS: read this, synthesize into prose. Do not emit verbatim. -->'
export const EVIDENCE_CLOSE = '<!-- END EVIDENCE FOR SYNTHESIS -->'

// The emoji-tree per-source footer the model passes through verbatim (the
// citation surface — no separate Sources: block).
export const FOOTER_OPEN = '<!-- PASS-THROUGH FOOTER -->'
export const FOOTER_CLOSE = '<!-- END PASS-THROUGH FOOTER -->'

// The all-sources-reported headline that opens the footer body.
export const FOOTER_HEADLINE = '✅ All agents reported back!'

// Every literal marker that must appear, identically, in both the engine output
// and the SKILL.md contract. The contract check iterates this list.
export const CONTRACT_MARKERS: readonly string[] = [
  BADGE_PREFIX,
  EVIDENCE_OPEN,
  EVIDENCE_CLOSE,
  FOOTER_OPEN,
  FOOTER_CLOSE,
  FOOTER_HEADLINE,
]
