/**
 * @file `walkComments` — every comment token in `source`, with oxc-shape
 *   metadata (kind / content / position / newlines / attachedTo). Comment types
 *   \+ the classifier live in `comment-types.mts`. Import from
 *   `../ast/index.mts`.
 */

import { classifyCommentContent } from './comment-types.mts'
import type {
  CommentContent,
  CommentKind,
  CommentPosition,
  CommentSite,
} from './comment-types.mts'
import type { AcornNode, ParseOptions } from './core.mts'
import {
  DEFAULT_PARSE_OPTIONS,
  offsetToLineCol,
  parseWasm,
  splitLines,
} from './core.mts'

/**
 * Wire-shape of a single Comment record on the AST root, emitted by the
 * acorn-wasm parser when `parse(source, { collectComments: true })` is set.
 * Mirrors oxc's program.comments. `walkComments` translates this into
 * `CommentSite` (which adds the legacy `line` / `text` / `value` fields).
 */
interface ParsedComment {
  start: number
  end: number
  attachedTo: number | null
  kind: CommentKind
  content: CommentContent
  position: CommentPosition
  newlineBefore: boolean
  newlineAfter: boolean
}

/**
 * Walk every comment token in `source`. Hooks that grade or filter comments
 * (no-meta-comments, pointer-comment, comment-tone) use this so they don't
 * false-positive on comment-looking content inside string literals or template
 * strings.
 *
 * Each `CommentSite` carries oxc-shape metadata: `kind` (Line / SingleLineBlock
 * / MultiLineBlock / Hashbang), `content` (pre-classified annotation),
 * `position` (Leading / Trailing), `newlines`, and `attachedTo` (offset of the
 * next token for leading comments).
 *
 * Opt-in: comment collection is OFF by default. Pass `{ comments: true }`. The
 * default-off shape matches oxc's "free at lex time but you have to ask for it"
 * stance — `walkComments` returns `[]` when off, with zero scanner cost.
 *
 * Implementation note: the acorn-wasm parser doesn't currently expose an
 * `onComment` callback, so the fallback path uses a character-level scanner
 * that's aware of `'…'`, `"…"`, and `\`…`` to skip strings/templates correctly;
 * comment-looking text inside a string literal won't be reported. Regex
 * literals containing `//` are a documented edge case the scanner doesn't
 * disambiguate.
 *
 * Returns the comments in source order. Empty array if source is empty.
 */
export function walkComments(
  source: string,
  options?: ParseOptions | undefined,
): CommentSite[] {
  // Opt-in. Default is OFF — caller must explicitly enable with
  // `{ comments: true }`. Modeled on oxc's collection-on-demand.
  if (options?.comments !== true) {
    return []
  }
  // Fast path: parser-level collection. The acorn-wasm parser exposes
  // Options.collectComments — when set, the AST root carries a `comments`
  // array of oxc-shape records ready-classified (kind / content / position /
  // attachedTo / newlineBefore+after). We just bolt on the legacy `line` +
  // `text` + `value` fields that pre-date the parser support.
  try {
    const parsed = parseWasm(source, {
      __proto__: null,
      ...DEFAULT_PARSE_OPTIONS,
      ...options,
      collectComments: true,
    } as unknown as ParseOptions) as
      | (AcornNode & { comments?: ParsedComment[] | undefined })
      | undefined
    const parsedComments = parsed?.['comments']
    if (Array.isArray(parsedComments) && parsedComments.length >= 0) {
      const lines = splitLines(source)
      return parsedComments.map((pc): CommentSite => {
        const { line } = offsetToLineCol(source, pc.start)
        const fullText = source.slice(pc.start, pc.end)
        let value: string
        if (pc.kind === 'Line') {
          value = fullText.startsWith('//') ? fullText.slice(2) : fullText
        } else if (pc.kind === 'Hashbang') {
          value = fullText.startsWith('#!') ? fullText.slice(2) : fullText
        } else {
          // SingleLineBlock or MultiLineBlock.
          value =
            fullText.startsWith('/*') && fullText.endsWith('*/')
              ? fullText.slice(2, -2)
              : fullText
        }
        return {
          kind: pc.kind,
          content: pc.content,
          position: pc.position,
          newlines: {
            before: pc.newlineBefore,
            after: pc.newlineAfter,
          },
          start: pc.start,
          end: pc.end,
          attachedTo: pc.attachedTo == null ? -1 : pc.attachedTo,
          value,
          line,
          text: (lines[line - 1] ?? '').trim(),
        }
      })
    }
  } catch {
    // Parser rejected the input (fragment, syntax error, future-syntax not yet
    // supported). Fall through to the legacy scanner — it's tolerant of
    // incomplete inputs and is the documented escape hatch.
  }
  // Internal record shape during the scan. We fill in `position`, `newlines`,
  // `attachedTo`, and `content` in a second pass after the full comment list is
  // known.
  interface PendingComment {
    kind: CommentKind
    start: number
    end: number
    value: string
    fullText: string
    line: number
    text: string
  }
  const pending: PendingComment[] = []
  const lines = splitLines(source)
  const len = source.length
  let i = 0
  let stringQuote: string | undefined
  let templateDepth = 0
  // Hashbang: only valid at offset 0 per ES2023 grammar.
  if (
    len >= 2 &&
    source.charCodeAt(0) === 35 /* # */ &&
    source.charCodeAt(1) === 33 /* ! */
  ) {
    let j = 2
    while (j < len && source.charCodeAt(j) !== 10 /* \n */) {
      j += 1
    }
    pending.push({
      kind: 'Hashbang',
      start: 0,
      end: j,
      value: source.slice(2, j),
      fullText: source.slice(0, j),
      line: 1,
      text: (lines[0] ?? '').trim(),
    })
    i = j
  }
  while (i < len) {
    const c = source[i]!
    if (stringQuote !== undefined) {
      if (c === '\\') {
        i += 2
        continue
      }
      if (c === stringQuote) {
        stringQuote = undefined
      }
      i += 1
      continue
    }
    if (templateDepth > 0) {
      if (c === '\\') {
        i += 2
        continue
      }
      // `${` opens an expression slot — drop out of template mode.
      if (c === '$' && source[i + 1] === '{') {
        templateDepth -= 1
        i += 2
        continue
      }
      if (c === '`') {
        templateDepth -= 1
      }
      i += 1
      continue
    }
    if (c === "'" || c === '"') {
      stringQuote = c
      i += 1
      continue
    }
    if (c === '`') {
      templateDepth += 1
      i += 1
      continue
    }
    if (c === '/' && source[i + 1] === '/') {
      const start = i
      let j = i + 2
      while (j < len && source.charCodeAt(j) !== 10) {
        j += 1
      }
      const { line } = offsetToLineCol(source, start)
      pending.push({
        kind: 'Line',
        start,
        end: j,
        value: source.slice(start + 2, j),
        fullText: source.slice(start, j),
        line,
        text: (lines[line - 1] ?? '').trim(),
      })
      i = j
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i
      let j = i + 2
      while (j < len - 1) {
        if (source[j] === '*' && source[j + 1] === '/') {
          j += 2
          break
        }
        j += 1
      }
      const body = source.slice(start + 2, j - 2)
      // SingleLine vs MultiLine block — does the body contain a newline?
      const isMulti = body.includes('\n') || body.includes('\r')
      const kind: CommentKind = isMulti ? 'MultiLineBlock' : 'SingleLineBlock'
      const { line } = offsetToLineCol(source, start)
      pending.push({
        kind,
        start,
        end: j,
        value: body,
        fullText: source.slice(start, j),
        line,
        text: (lines[line - 1] ?? '').trim(),
      })
      i = j
      continue
    }
    i += 1
  }

  // Second pass: compute position / newlines / attachedTo / content. We need
  // the offset of the next non-trivia token AFTER each comment for `attachedTo`:
  // scan forward from each comment's end, skipping whitespace + later comments.
  function nextNonTriviaOffset(from: number): number {
    let p = from
    while (p < len) {
      const ch = source.charCodeAt(p)
      // Whitespace.
      if (
        ch === 32 /* space */ ||
        ch === 9 /* tab */ ||
        ch === 10 /* \n */ ||
        ch === 13 /* \r */
      ) {
        p += 1
        continue
      }
      // Line comment to skip.
      if (ch === 47 /* / */ && source.charCodeAt(p + 1) === 47 /* / */) {
        while (p < len && source.charCodeAt(p) !== 10) {
          p += 1
        }
        continue
      }
      // Block comment to skip.
      if (ch === 47 /* / */ && source.charCodeAt(p + 1) === 42 /* * */) {
        p += 2
        while (p < len - 1) {
          if (
            source.charCodeAt(p) === 42 /* * */ &&
            source.charCodeAt(p + 1) === 47 /* / */
          ) {
            p += 2
            break
          }
          p += 1
        }
        continue
      }
      return p
    }
    return -1
  }

  function hasNewlineBefore(offset: number): boolean {
    let p = offset - 1
    while (p >= 0) {
      const ch = source.charCodeAt(p)
      if (ch === 10 /* \n */ || ch === 13 /* \r */) {
        return true
      }
      if (ch !== 32 && ch !== 9) {
        return false
      }
      p -= 1
    }
    // Start-of-file counts as having a newline before (the start boundary is
    // effectively a newline for attachment purposes).
    return true
  }

  function hasNewlineAfter(offset: number): boolean {
    let p = offset
    while (p < len) {
      const ch = source.charCodeAt(p)
      if (ch === 10 /* \n */ || ch === 13 /* \r */) {
        return true
      }
      if (ch !== 32 && ch !== 9) {
        return false
      }
      p += 1
    }
    return true
  }

  return pending.map((pc): CommentSite => {
    const before = hasNewlineBefore(pc.start)
    const after = hasNewlineAfter(pc.end)
    const position: CommentPosition = before ? 'Leading' : 'Trailing'
    const attachedTo = position === 'Leading' ? nextNonTriviaOffset(pc.end) : -1
    const content = classifyCommentContent(pc.kind, pc.fullText, pc.value)
    return {
      kind: pc.kind,
      content,
      position,
      newlines: { before, after },
      start: pc.start,
      end: pc.end,
      attachedTo,
      value: pc.value,
      line: pc.line,
      text: pc.text,
    }
  })
}
