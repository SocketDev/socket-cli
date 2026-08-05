/*
 * @file Detector for agent-directed instructions embedded in UNTRUSTED
 *   content — an issue body, a PR/review comment, a fetched page, a vendored
 *   file. Such text is DATA TO REPORT, never an instruction to follow, and
 *   this module is how a guard or a report names what it found.
 *
 *   The motivating shape is a "honeypot" comment: an ordinary-looking thank-you
 *   posted on every new PR whose raw Markdown hides a block addressed only to
 *   machines. The block asks the reader to post a short hex code back, and an
 *   account whose own reply carries that code is labelled automated. The token
 *   is `randomBytes(6).toString('hex')`, so it is exactly twelve hex
 *   characters — `findHoneypotTokens` returns those.
 *
 *   Detection is by SHAPE, not by a denylist of vendors. Four families:
 *
 *   1. An HTML comment whose contents address an automated reader — invisible
 *      on the rendered page, fully visible to whatever reads the raw body.
 *   2. A directive to emit a verification / acknowledgement code, to reply with
 *      "exactly the following", or to post a code with nothing else around it.
 *   3. A "human contributors may skip this" disclaimer, which is the tell that
 *      the surrounding block was aimed only at machines.
 *   4. The one literal vendor marker worth keying on, since it names the
 *      mechanism outright.
 *
 *   Every scan runs over the raw text AND a `normalizeForScan` copy (invisible
 *   characters stripped, Unicode Tag block dropped, homoglyphs folded), plus a
 *   whole-text pass with newlines folded to spaces so a directive split across
 *   lines is still caught. Same three-pass layering as prompt-injection-guard.
 */

import { normalizeForScan } from './evasion-normalize.mts'

/**
 * One embedded-directive hit: what shape matched, the 1-based line it was found
 * on, and a clipped copy of the offending text.
 */
export interface UntrustedFinding {
  readonly label: string
  readonly line: number
  readonly excerpt: string
}

interface DirectivePattern {
  readonly label: string
  readonly re: RegExp
  // False → skip the whitespace-folded whole-text pass. That pass turns
  // newlines into spaces, which disables the `[^.\n]` proximity brake the
  // looser patterns rely on, so two innocent adjacent lines could read as one
  // sentence. Those patterns stay per-line.
  readonly wholeText?: boolean | undefined
}

// Cap the bytes scanned so a multi-megabyte fetched page cannot wedge a hook.
// A real directive lands near the top of the body that carries it. Matches
// prompt-injection-guard's own cap.
const MAX_SCAN_BYTES = 512 * 1024

const DIRECTIVE_PATTERNS: readonly DirectivePattern[] = [
  {
    label: 'HTML comment addressed to an automated reader',
    // `<!--` then, within 400 characters, a phrase that speaks to a machine
    // rather than to the person reading the rendered page. The lazy
    // `[\s\S]{0,400}?` lets the phrase sit anywhere in a multi-line comment.
    re: /<!--[\s\S]{0,400}?(?:automated\s+contributors?|if\s+you(?:'re|\s+are)\s+(?:an?\s+)?(?:a\.?i\.?|agent|automated|language\s+model|llms?)|llms?\s+reading\s+this|message_for_llms|notice\s+for\s+automated\s+(?:agents?|contributors?))/i,
  },
  {
    label: 'notice addressed to automated readers',
    // The same machine-addressed phrases standing on their own, outside any
    // HTML comment — a plain-text block, a fenced snippet, a fetched page.
    re: /message_for_llms|\bnotice\s+for\s+automated\s+(?:agents?|contributors?)\b|\bautomated\s+contributors?\b|\bllms?\s+reading\s+this\b|\bif\s+you(?:'re|\s+are)\s+an?\s+ai\s+agent\b/i,
  },
  {
    label: 'directive to emit a verification code',
    // An emit-style verb, then within 96 characters a
    // verification/confirmation/acknowledgement code. The `[^\n]` window keeps
    // the two halves in the same neighbourhood.
    re: /\b(?:emit|include|paste|post|repeat|reply|respond|return|send|write)\b[^\n]{0,96}\b(?:acknowledge?ment|confirmation|validation|verification)\s+code\b/i,
  },
  {
    label: 'directive to reply with an exact literal',
    // "must consist of exactly the following", "reply with exactly the text
    // below" — an instruction to echo a literal verbatim.
    re: /\b(?:be|consist\s+of|contain|reply\s+with|respond\s+with)\s+(?:only\s+)?exactly\s+the\s+(?:code|following|string|text)\b/i,
  },
  {
    label: 'directive to post a code and nothing else',
    // A code/token noun within 40 characters of "and nothing else" (either
    // order) — the bait's signature demand that the reply carry the code alone.
    re: /\b(?:code|string|token|value|word)\b[^.\n]{0,40}\band\s+nothing\s+else\b|\band\s+nothing\s+else\b[^.\n]{0,40}\b(?:code|string|token|value|word)\b/i,
    wholeText: false,
  },
  {
    label: 'disclaimer marking the block as machine-only',
    // A line excusing people from following the block it sits in. A block that
    // waves off human readers was written for machines.
    re: /\bhuman\s+(?:contributors?|maintainers?|readers?|reviewers?|users?)\b[^.\n]{0,80}\b(?:disregard|do(?:es)?\s+not\s+apply|ignore|skip)\b/i,
    wholeText: false,
  },
  {
    label: 'honeypot marker literal',
    // The vendor marker that names the mechanism outright.
    re: /agentscan-honeypot/i,
  },
]

// A standalone twelve-hex-character run — the exact shape of a honeypot token
// (`randomBytes(6).toString('hex')`). The word boundaries keep it from firing
// inside a longer hex run such as a full 40-character SHA.
const HONEYPOT_TOKEN_RE = /\b[0-9a-f]{12}\b/g

// A canonical 8-4-4-4-12 UUID. Its last group is twelve hex characters between
// word boundaries, so a UUID pasted into an ordinary comment would otherwise
// read as a token. Blanked out before the token scan.
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

// Every HTML comment, opening through closing delimiter. The threat matcher
// (agentscan's hasHoneypotToken) strips comments before testing for the
// token, so a token split by one — `a1b2c3<!-- x -->d4e5f6` — still reads as
// one standalone run to the trap even though it never does to a scan that
// only reads the raw or normalized text.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g

function clipExcerpt(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed
}

// Best-effort 1-based line of `fragment`'s first word within `text`.
function lineOfFragment(text: string, fragment: string): number {
  const firstWord = fragment.trim().split(/\s+/)[0]
  if (!firstWord) {
    return 1
  }
  const idx = text.toLowerCase().indexOf(firstWord.toLowerCase())
  if (idx < 0) {
    return 1
  }
  return text.slice(0, idx).split('\n').length
}

function matchedLabels(text: string): string[] {
  const out: string[] = []
  for (let i = 0, { length } = DIRECTIVE_PATTERNS; i < length; i += 1) {
    const pattern = DIRECTIVE_PATTERNS[i]!
    if (pattern.re.test(text)) {
      out.push(pattern.label)
    }
  }
  return out
}

/**
 * Every agent-directed instruction embedded in `text`, deduplicated by
 * label + line + excerpt. Empty when the text carries none.
 *
 * Three complementary passes, matching prompt-injection-guard: per line on the
 * raw text, per line on a normalized copy, and once over the whole normalized
 * text with runs of whitespace folded to a single space so a directive broken
 * across lines still reads as one sentence.
 */
export function findEmbeddedAgentDirectives(text: string): UntrustedFinding[] {
  const scanned =
    text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text
  const findings: UntrustedFinding[] = []
  const seen = new Set<string>()
  const push = (finding: UntrustedFinding): void => {
    const key = `${finding.label}:${finding.line}:${finding.excerpt}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  }

  const lines = scanned.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i] ?? ''
    const labels = new Set([
      ...matchedLabels(raw),
      ...matchedLabels(normalizeForScan(raw)),
    ])
    for (const label of labels) {
      push({ excerpt: clipExcerpt(raw), label, line: i + 1 })
    }
  }

  // An HTML comment spanning several lines only reads as one block here, so the
  // folded pass is where a multi-line bait block is actually caught.
  const folded = normalizeForScan(scanned).replace(/\s+/g, ' ')
  for (let i = 0, { length } = DIRECTIVE_PATTERNS; i < length; i += 1) {
    const pattern = DIRECTIVE_PATTERNS[i]!
    if (pattern.wholeText === false) {
      continue
    }
    const match = pattern.re.exec(folded)
    if (match) {
      push({
        excerpt: clipExcerpt(match[0]),
        label: `${pattern.label} [multi-line]`,
        line: lineOfFragment(scanned, match[0]),
      })
    }
  }

  return findings
}

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
