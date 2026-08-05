/*
 * @file Prose normalization for a CODE file's pattern-shaped detection.
 *
 *   A comment body and a plain string literal in a code file are PROSE. They
 *   hold sentences, table rows, fixture text, and version notes, and markdown
 *   formatting inside them SYNTHESIZES pattern syntax nobody wrote: `REDOS_RE`
 *   needs a `)` followed by `+` or `*`, and the bolded note `**(6+)**` supplies
 *   that trailing `*` out of its own closing delimiter. A markdown file already
 *   reads normalized lines for this reason. A `.mts` whose comments and fixture
 *   strings carry the same prose needs the same treatment, and until it got one
 *   a fixture table row was read as a quantified group.
 *
 *   So a code line is split into regions and only the prose ones are
 *   emphasis-stripped. A region keeps its bytes when a pattern written there is
 *   real pattern source:
 *     - a `/…/flags` regex literal, inside a comment body included
 *     - a string literal whose content is regex-shaped
 *     - a string literal handed to a regex CONSTRUCTOR
 *     - every other code token
 *
 *   Shape wins over position, so `'^(a+)+$'` is read as the pattern it is
 *   wherever it sits. Position covers what shape cannot: `RegExp`, `Regex::new`,
 *   `MustCompile`, and `compile` take the PATTERN as their argument, so that
 *   argument is pattern source however it reads — `'(.*)*'` is a hang whether or
 *   not it is anchored. `.test`, `.exec`, and `.replace` take the SUBJECT
 *   instead, which is why the constructor set here is narrower than
 *   `REGEX_CALL_RE`: a bolded note handed to one of those is the haystack.
 *
 *   The Zalgo, megaline, repeated-character, and entity-expansion detectors
 *   never read this normalization; they read the raw line. A token bomb is never
 *   excused by formatting.
 */

import { stripMarkdownEmphasisDelimiters } from './markdown-scan.mts'
import { isRegexLiteralLeader, isRegexSourceShaped } from './scan-context.mts'

export type CodeSegmentKind = 'prose' | 'verbatim'

export interface CodeSegment {
  readonly kind: CodeSegmentKind
  readonly text: string
}

export interface CodeSegmentOptions {
  // True → the line opens inside an unterminated `/* … */`, so its leading text
  // is comment prose up to the closer.
  blockComment?: boolean | undefined
}

export interface CodeSegmentScan {
  // True → a `/* … */` is still open at end of line, so the next line opens in
  // comment prose. That is the safe direction for a doc block.
  readonly blockComment: boolean
  readonly segments: CodeSegment[]
}

// A regex CONSTRUCTOR call opening, matched against the line text to the LEFT of
// a quote. Each of these APIs takes the pattern itself, so its argument stays
// verbatim no matter how the content reads. The trailing `r?` admits Rust's
// raw-string prefix.
const REGEX_CONSTRUCTOR_ARG_RE =
  /(?:\.(?:MustCompile|compile)|\bRegExp|\bRegex::new|\bRegexp|\bpreg_(?:match|match_all|replace|split))\s*\(\s*r?$/

// A regex literal's trailing flag letters.
const REGEX_FLAG_RE = /[dgimsuvy]/

const QUOTES = new Set(["'", '"', '`'])

/**
 * Index in `line` of the unescaped `quote` closing a literal that opened before
 * `from`, or `-1` when it never closes on this line. An unclosed quote is how
 * an apostrophe in comment prose and a multi-line template literal both read,
 * and the caller falls back to treating the quote as ordinary text.
 */
export function findStringLiteralClose(
  line: string,
  from: number,
  quote: string,
): number {
  const { length } = line
  let i = from
  while (i < length) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) {
      return i
    }
    i += 1
  }
  return -1
}

/**
 * End index, exclusive, of the `/…/flags` regex literal opening at `openIndex`,
 * or `-1` when it never closes on this line. A bracket class is stepped over
 * whole so `[/]` does not close the literal early, the same allowance
 * `REGEX_LITERAL_RE` makes.
 */
export function findRegexLiteralEnd(line: string, openIndex: number): number {
  const { length } = line
  let i = openIndex + 1
  let inClass = false
  while (i < length) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false
      }
      i += 1
      continue
    }
    if (ch === '[') {
      inClass = true
      i += 1
      continue
    }
    if (ch === '/') {
      i += 1
      while (i < length && REGEX_FLAG_RE.test(line[i]!)) {
        i += 1
      }
      return i
    }
    i += 1
  }
  return -1
}

/**
 * True when the string literal opening at `quoteIndex` is a regex
 * constructor's argument, which makes its content pattern source whatever it
 * reads like.
 */
export function isRegexConstructorArgument(
  line: string,
  quoteIndex: number,
): boolean {
  return REGEX_CONSTRUCTOR_ARG_RE.test(line.slice(0, quoteIndex))
}

/**
 * `line` split into the regions that get emphasis-stripped and the regions that
 * keep their bytes, plus the block-comment state the next line inherits.
 */
export function splitCodeSegments(
  line: string,
  options?: CodeSegmentOptions | undefined,
): CodeSegmentScan {
  const opts = { __proto__: null, ...options } as CodeSegmentOptions
  const segments: CodeSegment[] = []
  const { length } = line
  let blockComment = opts.blockComment === true
  let lineComment = false
  let buffer = ''
  let bufferKind: CodeSegmentKind = 'verbatim'
  let i = 0

  function flush(): void {
    if (buffer) {
      segments.push({ kind: bufferKind, text: buffer })
      buffer = ''
    }
  }

  function emit(kind: CodeSegmentKind, text: string): void {
    if (!text) {
      return
    }
    if (kind !== bufferKind) {
      flush()
      bufferKind = kind
    }
    buffer += text
  }

  // Unclaimed text is prose inside a comment and code everywhere else.
  function defaultKind(): CodeSegmentKind {
    return blockComment || lineComment ? 'prose' : 'verbatim'
  }

  while (i < length) {
    const ch = line[i]!
    // An escape carries its escapee through as ordinary text, so `\'` never
    // opens a literal and `\*` keeps its mark.
    if (ch === '\\' && i + 1 < length) {
      emit(defaultKind(), line.slice(i, i + 2))
      i += 2
      continue
    }
    if (blockComment) {
      if (ch === '*' && line[i + 1] === '/') {
        blockComment = false
        emit('verbatim', '*/')
        i += 2
        continue
      }
    } else if (!lineComment && ch === '/') {
      const next = line[i + 1]
      if (next === '/') {
        lineComment = true
        emit('verbatim', '//')
        i += 2
        continue
      }
      if (next === '*') {
        blockComment = true
        emit('verbatim', '/*')
        i += 2
        continue
      }
    }
    if (ch === '/' && isRegexLiteralLeader(i > 0 ? line[i - 1]! : '')) {
      const end = findRegexLiteralEnd(line, i)
      if (end > 0) {
        emit('verbatim', line.slice(i, end))
        i = end
        continue
      }
    }
    if (QUOTES.has(ch)) {
      const close = findStringLiteralClose(line, i + 1, ch)
      if (close > 0) {
        const body = line.slice(i + 1, close)
        const pattern =
          isRegexSourceShaped(body) || isRegexConstructorArgument(line, i)
        emit('verbatim', ch)
        emit(pattern ? 'verbatim' : 'prose', body)
        emit('verbatim', ch)
        i = close + 1
        continue
      }
    }
    emit(defaultKind(), ch)
    i += 1
  }
  flush()
  return { blockComment, segments }
}

/**
 * `lines` normalized for the pattern-shaped scan, one output line per input
 * line. Comment bodies and plain string literals lose their paired emphasis
 * delimiters; a regex literal, a regex-shaped literal, a constructor argument,
 * and every other code token pass through byte for byte.
 */
export function normalizeCodeForPatternScan(
  lines: readonly string[],
): string[] {
  const out: string[] = []
  let blockComment = false
  for (const line of lines) {
    const scan = splitCodeSegments(line, { blockComment })
    blockComment = scan.blockComment
    let text = ''
    for (const segment of scan.segments) {
      text +=
        segment.kind === 'prose'
          ? stripMarkdownEmphasisDelimiters(segment.text)
          : segment.text
    }
    out.push(text)
  }
  return out
}
