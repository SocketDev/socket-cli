/*
 * @file The twelve-hex honeypot-token mechanism.
 *
 *   The motivating shape is a "honeypot" comment: an ordinary-looking thank-you
 *   posted on every new PR whose raw Markdown hides a block addressed only to
 *   machines. The block asks the reader to post a short hex code back, and an
 *   account whose own reply carries that code is labelled automated. The token
 *   is `randomBytes(6).toString('hex')`, so it is exactly twelve hex
 *   characters — `findHoneypotTokens` returns those.
 *
 *   Every scan runs over the raw text AND a `normalizeForScan` copy (invisible
 *   characters stripped, Unicode Tag block dropped, homoglyphs folded), plus a
 *   comment-stripped copy of each, so a token split across an HTML comment
 *   boundary is still caught.
 */

import { normalizeForScan } from '../evasion-normalize.mts'

// A standalone twelve-hex-character run — the exact shape of a honeypot token
// (`randomBytes(6).toString('hex')`). The word boundaries keep it from firing
// inside a longer hex run such as a full 40-character SHA.
export const HONEYPOT_TOKEN_RE = /\b[0-9a-f]{12}\b/g

// A canonical 8-4-4-4-12 UUID. Its last group is twelve hex characters between
// word boundaries, so a UUID pasted into an ordinary comment would otherwise
// read as a token. Blanked out before the token scan.
export const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

// Every HTML comment, opening through closing delimiter. The threat matcher
// (agentscan's hasHoneypotToken) strips comments before testing for the
// token, so a token split by one — `a1b2c3<!-- x -->d4e5f6` — still reads as
// one standalone run to the trap even though it never does to a scan that
// only reads the raw or normalized text.
export const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * Every standalone twelve-hex-character token in `text`, in first-seen order
 * and deduplicated. That is the honeypot token shape; a caller decides which of
 * them are legitimate (an abbreviated commit SHA resolves against the repo, a
 * bait token does not).
 *
 * A UUID's final group is also twelve hex characters, so UUIDs are blanked out
 * first — pasting one into a comment is ordinary, not bait.
 *
 * Scans the raw text, a `normalizeForScan` copy, AND a comment-stripped copy
 * of each — mirroring the upstream matcher's own comment-stripping pass, so a
 * token split across an HTML comment boundary is still caught.
 */
export function findHoneypotTokens(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const base = [text, normalizeForScan(text)]
  const variants = [...base, ...base.map(v => v.replace(HTML_COMMENT_RE, ''))]
  for (let i = 0, { length } = variants; i < length; i += 1) {
    const raw = variants[i]!
    const source = raw.replace(UUID_RE, ' ')
    HONEYPOT_TOKEN_RE.lastIndex = 0
    let match = HONEYPOT_TOKEN_RE.exec(source)
    while (match) {
      const token = match[0].toLowerCase()
      if (!seen.has(token)) {
        seen.add(token)
        out.push(token)
      }
      match = HONEYPOT_TOKEN_RE.exec(source)
    }
  }
  return out
}
