/*
 * @file Shared vocabulary for the parenthetical-aside doctrine, which is
 *   enforced on two surfaces by two consumers:
 *
 *   - `fleet/no-parenthetical-aside` — source COMMENTS, via the oxlint plugin.
 *   - `scripts/fleet/check/prose-parenthetical-asides-are-absent.mts` —
 *     MARKDOWN prose, via a check script.
 *
 *   Both had their own copy of the word floor and the lead-in allowlist, and
 *   the copies had already drifted: one knew `(default …)` was an annotation,
 *   the other knew a bare URL was a reference, and neither knew both. Anything
 *   the two MUST agree on lives here.
 *
 *   What deliberately does NOT live here: how each surface finds a group, and
 *   how it decides a clause is an aside. Those are not duplicates, they are
 *   different by design — the rule matches INNERMOST `(...)` groups and reads
 *   comment text, the check walks OUTERMOST groups and understands fenced code
 *   blocks. Folding them together would change what each reports.
 */

// Words a clause needs before it reads as an aside rather than a short marker
// or reference. Both surfaces use the same floor so the same sentence is not
// an aside in a comment and fine in a doc.
export const MIN_ASIDE_WORDS = 4

/**
 * Lead-ins that make a parenthetical a legitimate reference, gloss, or
 * annotation rather than an aside to rewrite: abbreviation glosses
 * (`aka`, `e.g.`, `i.e.`, `viz.`), a pointer (`see …`), a `default …`
 * annotation, and a bare URL.
 */
export const PARENTHETICAL_LEADIN_RE =
  /^(?:a\.k\.a\.|aka\b|cf\.|default(?:\b|s\b)|e\.g\.|eg\b|https?:\/\/|i\.e\.|ie\b|resp\.|see\b|viz\.)/i

/**
 * Whether a parenthetical has at least one lowercase alphabetic word. Prose
 * has these; an identifier, a SCREAMING_CASE token, and pure symbol soup do
 * not, so this separates a sentence from a code reference.
 */
export function hasProseWord(text: string): boolean {
  return /\b[a-z]{2,}\b/.test(text)
}

/**
 * Whether a parenthetical holds enough words to read as a clause.
 */
export function meetsAsideWordFloor(text: string): boolean {
  return text.trim().split(/\s+/).length >= MIN_ASIDE_WORDS
}
