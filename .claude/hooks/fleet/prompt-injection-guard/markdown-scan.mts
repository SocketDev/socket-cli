/*
 * @file Markdown normalization for the prompt-injection-guard's pattern-shaped
 *   detection.
 *
 *   `*`, `_`, `~`, and the backtick are markdown FORMATTING syntax and regex or
 *   glob METACHARACTERS at the same time, so a detector reading raw markdown lets
 *   ordinary formatting SYNTHESIZE pattern syntax the author never typed.
 *   `REDOS_RE` needs a `)` followed by `+` or `*`. The bolded version note
 *   `**(6+)**` supplies exactly that trailing `*` out of its own closing
 *   delimiter, and the bare `(6+)` supplies nothing at all — the emphasis marks
 *   ARE the match. The same holds for `_`, `~`, and a backtick, so the class is
 *   wider than the one detector that surfaced it.
 *
 *   So every line of a markdown file is normalized before the pattern-shaped scan
 *   reads it: paired emphasis, strong, and strikethrough delimiters are dropped
 *   and their inner text kept, leaving prose that carries only the
 *   metacharacters its author wrote.
 *
 *   Two kinds of span keep their original bytes and are marked CODE, because a
 *   regex written in code is real pattern source: a fenced block and an inline
 *   code span. The flag widens the positions the ReDoS detector reads, so a
 *   payload inside a fence still blocks. A link or image destination keeps its
 *   bytes as well, so a URL's own underscores survive.
 *
 *   The Zalgo, megaline, repeated-character, and entity-expansion detectors never
 *   read this normalization; they read the raw line. A token bomb is never
 *   excused by formatting.
 */

export interface MarkdownScanLine {
  // True → the line's text is code: a fenced block's body, a fence delimiter, or
  // a line carrying an inline code span. A pattern written in code is real, so
  // the ReDoS detector widens its pattern positions for this line.
  readonly code: boolean
  // The line with paired emphasis, strong, and strikethrough delimiters removed.
  // A code span and a link or image destination keep their original bytes.
  readonly text: string
}

export type MarkdownSegmentKind = 'code' | 'destination' | 'prose'

export interface MarkdownSegment {
  readonly kind: MarkdownSegmentKind
  readonly text: string
}

// A fenced-code delimiter: three or more backticks or tildes, indented at most
// three spaces, which is CommonMark's ceiling before the line becomes an
// indented code block.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/

// A paired `**` or `__` strong run wrapping non-blank text. The backreference
// pairs a run with its own kind, and the flanking guards keep a lone run and a
// spaced `a ** b` from matching.
const STRONG_RE = /(\*\*|__)(?![\s*_])((?:(?!\1)[\s\S])+?)(?<![\s*_])\1/g

// A paired single `*` or `_` emphasis run wrapping non-blank text. The
// word-character guards keep `snake_case_name` and `a*b` intact.
const EMPHASIS_RE =
  /(?<![*\w])([*_])(?![\s*_])((?:(?!\1)[\s\S])+?)(?<![\s*_])\1(?![*\w])/g

// A paired `~~` strikethrough run wrapping non-blank text.
const STRIKETHROUGH_RE = /~~(?![\s~])((?:(?!~~)[\s\S])+?)(?<![\s~])~~/g

/**
 * Start index in `line` at or after `from` of a backtick run exactly
 * `runLength` long, which is what closes an inline code span opened by a run of
 * that length. `-1` when the span never closes on this line.
 */
export function findBacktickRunClose(
  line: string,
  from: number,
  runLength: number,
): number {
  const { length } = line
  let i = from
  while (i < length) {
    if (line[i] !== '`') {
      i += 1
      continue
    }
    const start = i
    while (i < length && line[i] === '`') {
      i += 1
    }
    if (i - start === runLength) {
      return start
    }
  }
  return -1
}

/**
 * `line` split into the spans that get normalized and the spans that keep their
 * bytes: an inline code span is `code`, a link or image destination is
 * `destination`, and everything else is `prose`.
 */
export function splitMarkdownSegments(line: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = []
  const { length } = line
  let prose = ''
  let i = 0

  function flushProse(): void {
    if (prose) {
      segments.push({ kind: 'prose', text: prose })
      prose = ''
    }
  }

  while (i < length) {
    const ch = line[i]!
    // A backslash escape carries its escapee through untouched, so `\*not bold\*`
    // keeps both marks.
    if (ch === '\\' && i + 1 < length) {
      prose += line.slice(i, i + 2)
      i += 2
      continue
    }
    if (ch === '`') {
      let runEnd = i + 1
      while (runEnd < length && line[runEnd] === '`') {
        runEnd += 1
      }
      const closeStart = findBacktickRunClose(line, runEnd, runEnd - i)
      if (closeStart < 0) {
        prose += line.slice(i, runEnd)
        i = runEnd
        continue
      }
      flushProse()
      const end = closeStart + (runEnd - i)
      segments.push({ kind: 'code', text: line.slice(i, end) })
      i = end
      continue
    }
    // `](destination)` closing a link or image label. The destination is a URL,
    // where an underscore or asterisk belongs to the address.
    if (ch === ']' && line[i + 1] === '(') {
      const close = line.indexOf(')', i + 2)
      if (close >= 0) {
        prose += ch
        flushProse()
        segments.push({
          kind: 'destination',
          text: line.slice(i + 1, close + 1),
        })
        i = close + 1
        continue
      }
    }
    prose += ch
    i += 1
  }
  flushProse()
  return segments
}

/**
 * `text` with paired strikethrough, strong, and emphasis delimiters removed and
 * their inner text kept. Strong runs first so `**bold**` is never read as a
 * single `*` pair around `*bold*`.
 */
export function stripMarkdownEmphasisDelimiters(text: string): string {
  return text
    .replace(STRIKETHROUGH_RE, '$1')
    .replace(STRONG_RE, '$2')
    .replace(EMPHASIS_RE, '$2')
}

/**
 * One markdown line normalized for the pattern-shaped scan: emphasis delimiters
 * dropped from its prose, code spans and link destinations byte-for-byte, and a
 * `code` flag set when the line carries an inline code span.
 */
export function normalizeMarkdownLine(line: string): MarkdownScanLine {
  let code = false
  let text = ''
  for (const segment of splitMarkdownSegments(line)) {
    if (segment.kind === 'prose') {
      text += stripMarkdownEmphasisDelimiters(segment.text)
      continue
    }
    if (segment.kind === 'code') {
      code = true
    }
    text += segment.text
  }
  return { code, text }
}

/**
 * `lines` normalized for the pattern-shaped scan, one output entry per input
 * line so a caller can keep reading the raw line beside it. A fenced block's
 * body and its delimiters pass through verbatim and marked as code; an unclosed
 * fence marks every line after it as code, which is the safe direction.
 */
export function normalizeMarkdownForPatternScan(
  lines: readonly string[],
): MarkdownScanLine[] {
  const out: MarkdownScanLine[] = []
  let fenceChar = ''
  let fenceLength = 0
  for (const line of lines) {
    const fence = FENCE_RE.exec(line)
    const marker = fence?.[1]
    if (fenceChar) {
      out.push({ code: true, text: line })
      if (marker && marker[0] === fenceChar && marker.length >= fenceLength) {
        fenceChar = ''
        fenceLength = 0
      }
      continue
    }
    if (marker) {
      fenceChar = marker[0]!
      fenceLength = marker.length
      out.push({ code: true, text: line })
      continue
    }
    out.push(normalizeMarkdownLine(line))
  }
  return out
}
