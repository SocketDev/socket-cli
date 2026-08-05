/*
 * @file "AI bombs" — content engineered to lock up, hang, or exhaust an agent
 *   that READS it (a denial-of-service on the reader, distinct from a directive
 *   that hijacks it). Thresholds sit well above anything authored by hand.
 *
 *   Two detectors are position-scoped rather than whole-line, because a token can
 *   carry the shape without meaning it (`scan-context.mts` holds the reasoning):
 *     - ReDoS runs against pattern positions only, so `(6+)` in markdown prose
 *       is not read as a quantified group.
 *     - The megaline pair is skipped for a generated / encoded artifact, whose
 *       unbroken lines came out of a generator rather than an author.
 *
 *   In a markdown file the ReDoS detector reads NORMALIZED lines, because
 *   markdown's emphasis delimiters are themselves regex metacharacters and
 *   formatting can synthesize a pattern nobody wrote (`markdown-scan.mts` holds
 *   the reasoning). A code file gets the same normalization over the regions
 *   that are prose rather than pattern source — a comment body and a plain
 *   string literal (`code-scan.mts` holds that reasoning).
 *
 *   The Zalgo, repeated-character, and entity-expansion detectors stay
 *   unconditional: no file kind has a legitimate reason to carry one.
 */

import { normalizeCodeForPatternScan } from './code-scan.mts'
import { clipSource, lineOfFirstWord } from './findings.mts'
import type { Finding } from './findings.mts'
import { normalizeMarkdownForPatternScan } from './markdown-scan.mts'
import { findRegexPatternCandidates } from './scan-context.mts'

export interface BombScanOptions {
  // True → the file is code, widening the pattern positions the ReDoS detector
  // reads, because a quoted string there may be a regex source, and narrowing
  // the text it reads them from: a comment body and a plain string literal are
  // prose, so their emphasis delimiters are stripped first.
  codeFile?: boolean | undefined
  // True → the file is a generated / vendored / encoded artifact, so its long
  // unbroken lines are not a hand-authored context bomb.
  encodedArtifact?: boolean | undefined
  // True → the file is markdown, so the ReDoS detector reads each line with its
  // emphasis delimiters stripped, and a fenced or inline code span is read as
  // code.
  markdownFile?: boolean | undefined
}

// A base character carrying a long run of combining marks (Zalgo): token-heavy,
// renders as an unreadable blob, crashes some layout engines. The ranges are the
// combining diacritical blocks only — the marks of Arabic, Devanagari, Hebrew,
// Thai, and the other non-Latin scripts sit outside them, and no script stacks 8
// of these on one base.
// oxlint-disable-next-line eslint/no-misleading-character-class -- the combining-mark ranges ARE the detector's subject; this class deliberately matches stacked combining diacritics, which is exactly what the rule flags as "misleading."
const ZALGO_RE = /[̀-ͯ҃-҉᪰-᫿᷀-᷿⃐-⃿︠-︯]{8,}/

// Nested-quantifier patterns that backtrack catastrophically: `(a+)+`, `(.*)*`,
// `(\d+)+$` and friends. Authored into a pattern position these are a ReDoS
// waiting to hang whatever runs them.
const REDOS_RE =
  /\([^)]*[+*]\)[+*]|\((?:[^()]*\|[^()]*)\)[+*](?:[+*]|\{\d+,?\}?)/

// XML / DTD entity-expansion ("billion laughs") and YAML alias-bomb shapes: an
// entity / anchor that references another repeatedly.
const ENTITY_BOMB_RE =
  /<!ENTITY\s+\w+\s+(?:"[^"]*(?:&\w+;){2,}|'[^']*(?:&\w+;){2,})|(?:\*\w+\s+){10,}/

const MAX_LINE_LEN = 50_000
const MAX_LINE_NO_BREAK = 20_000
const MAX_CHAR_RUN = 5000

export function findBombFindings(
  text: string,
  rawLines: string[],
  options?: BombScanOptions | undefined,
): Finding[] {
  const opts = { __proto__: null, ...options } as BombScanOptions
  const patternOptions = { codeFile: opts.codeFile }
  const codePatternOptions = { codeFile: true }
  const markdownFile = opts.markdownFile === true
  const markdownLines = markdownFile
    ? normalizeMarkdownForPatternScan(rawLines)
    : undefined
  const codeLines =
    !markdownFile && opts.codeFile === true
      ? normalizeCodeForPatternScan(rawLines)
      : undefined
  const out: Finding[] = []
  for (let i = 0; i < rawLines.length; i += 1) {
    /* c8 ignore next - String.prototype.split always yields string elements; rawLines[i] is never undefined */
    const raw = rawLines[i] ?? ''
    const lineNo = i + 1

    if (ZALGO_RE.test(raw)) {
      out.push({
        line: lineNo,
        label: 'combining-mark (Zalgo) bomb — long run of stacked diacritics',
        source: clipSource(raw.trim()),
      })
    }
    if (opts.encodedArtifact !== true) {
      if (raw.length >= MAX_LINE_NO_BREAK && !/\s/.test(raw)) {
        out.push({
          line: lineNo,
          label: `pathological line — ${raw.length} chars with no whitespace (context/diff bomb)`,
          source: clipSource(raw.trim()),
        })
      } else if (raw.length >= MAX_LINE_LEN) {
        out.push({
          line: lineNo,
          label: `very long line — ${raw.length} chars (context bloat)`,
          source: clipSource(raw.trim()),
        })
      }
    }
    // Matches any character repeated 5000+ times in a row (token/context bomb).
    const runMatch = /(.)\1{4999,}/.exec(raw)
    if (runMatch && runMatch[0].length >= MAX_CHAR_RUN) {
      out.push({
        line: lineNo,
        /* c8 ignore next - capture group 1 is always a non-empty string when runMatch is truthy; ?? '' is a defensive fallback */
        label: `repeated-character run — ${runMatch[0].length}× '${describeChar(runMatch[1] ?? '')}' (token bomb)`,
        source: clipSource(raw.trim()),
      })
    }
    // Markdown and code both read a normalized line, so a bolded `**(6+)**`
    // note carries no synthetic quantifier. A markdown code span or fence keeps
    // its bytes and widens the positions; a code file's regex literals,
    // regex-shaped literals, and constructor arguments keep theirs. A real
    // pattern written in any of them is still read as one.
    const markdownLine = markdownLines?.[i]
    const patternText = markdownLine?.text ?? codeLines?.[i] ?? raw
    const linePatternOptions =
      markdownLine?.code === true ? codePatternOptions : patternOptions
    for (const candidate of findRegexPatternCandidates(
      patternText,
      linePatternOptions,
    )) {
      if (REDOS_RE.test(candidate)) {
        out.push({
          line: lineNo,
          label: 'catastrophic-backtracking regex (ReDoS) literal',
          source: clipSource(raw.trim()),
        })
        break
      }
    }
  }
  if (ENTITY_BOMB_RE.test(text)) {
    out.push({
      /* c8 ignore next - lineOfFirstWord returns ≥ 1 (it falls back to 1 when idx < 0); || 1 is unreachable */
      line: lineOfFirstWord(text, '<!ENTITY') || 1,
      label: 'entity/alias expansion bomb (billion-laughs shape)',
      source: 'nested entity or YAML-alias expansion',
    })
  }
  return out
}

export function describeChar(ch: string): string {
  /* c8 ignore next - codePointAt(0) only returns undefined for an empty string; ch is always a non-empty captured group */
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 32 || (cp >= 127 && cp < 160)) {
    return `\\u${cp.toString(16).padStart(4, '0')}`
  }
  return ch
}
