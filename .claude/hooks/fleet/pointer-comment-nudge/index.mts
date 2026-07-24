#!/usr/bin/env node
// Claude Code PreToolUse hook — pointer-comment-nudge.
//
// renamed-from: pointer-comment-guard
//
// Flags pointer-style comments ("see X", "see X for details", "full
// rationale in Y", "documented in Z", "see the @fileoverview JSDoc
// above") that DON'T also carry a one-line claim explaining the
// decision. Per CLAUDE.md "Code style → Pointer comments":
//
//   Pointer comments are acceptable when (a) the destination
//   actually carries the load-bearing explanation, AND (b) the
//   inline form carries the one-line claim so a reader who never
//   follows the pointer still walks away with the *why*. A pointer
//   with neither is dead weight; a pointer with only (a) fails the
//   "the reader should fix the problem from the comment alone" test.
//
// This hook can verify (b) syntactically (claim present in the same
// comment block). It can't verify (a) — that would require following
// the pointer and assessing destination quality.
//
// What we accept (passing comments):
//
//   // Why uncurried, not Fast-API'd: see the fileoverview JSDoc
//   // above. V8's existing hot path beats trampoline overhead.
//
//   // Searches stay uncurried — V8's hot path beats any Fast API
//   // binding here. Full rationale in the @fileoverview JSDoc above.
//
//   // See https://example.com for details about the X-Y-Z header
//   // shape; that spec also dictates the ordering used below.
//
// What we flag (bare pointers, no claim):
//
//   // See the @fileoverview JSDoc above.
//
//   // Full rationale in the fileoverview.
//
//   // See X for details.
//
// Scope:
//   - Source files only (.ts / .mts / .cts / .js / .mjs / .cjs / .tsx
//     / .jsx). Markdown, configs, and tests are skipped.
//   - Only applies to comments that begin with a pointer phrase. A
//     comment that has the claim FIRST and the pointer second always
//     passes (the bug we're guarding against is pointer-without-why).
//
// Bypass: "Allow pointer-comment bypass" in a recent user turn, or

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { walkComments } from '../_shared/ast/comments.mts'
import { splitLines } from '../_shared/ast/core.mts'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// Match JS/TS source file extensions: .js, .mjs, .cjs, .ts, .mts, .cts, .jsx, .tsx.
const SOURCE_EXT_RE = /\.(?:c|m)?[jt]sx?$/

// A line is a "comment" line if it starts (after optional whitespace
// and `*` for block-comment continuation) with `//` or is inside a
// `/* … */` block. We normalize comment groups before scanning.
//
// A pointer phrase opens with one of these patterns. They are the
// canonical "see X" / "rationale in Y" shapes — narrow enough to
// avoid false positives on prose like "I'll see if this works."
const POINTER_OPENERS_RE =
  /^(?:defined in\b|described in\b|details in\b|documented in\b|full rationale in\b|rationale in\b|reference[sd]? in\b|see\b|specified in\b)/i

// A pointer-only comment is one where, after stripping the pointer
// phrase + its target, no claim text remains. We detect the boundary
// by looking for a continuation that doesn't itself start with another
// pointer phrase and contains an active verb / claim shape.
//
// Claim shapes (any of these in the SAME comment passes the check):
//   - "X beats / wins / wraps / replaces / avoids / prevents / forces
//      / requires / blocks / matches / fails / throws Y"
//   - "because / since / due to / so that / to <verb>"
//   - "X is Y" / "X are Y" (assertion shape)
//   - "X — Y" / "X: Y" / "X; Y" (em-dash / colon / semicolon claim)
//   - "X — Y" with Y being a sentence (verb present)
//
// This is heuristic, not parser-accurate; we err on the side of
// passing comments to keep false-positive cost low. The flag only
// fires on the unambiguous case: a bare pointer with nothing else.
const CLAIM_SHAPE_RE =
  /\b(?:beats|wins|wraps|replaces|avoids|prevents|forces|requires|blocks|matches|fails|throws|returns|does|doesn'?t|will|won'?t|is|are|was|were|because|since|so that|to\s+\w+|since\s+\w+|due to)\b/i

interface Comment {
  readonly text: string
  readonly lineNumber: number
}

// Split source into comment blocks via the AST walker. A "block" is
// one logical comment: a `/* … */` span (one CommentSite from the
// walker), or a run of consecutive `//` lines (we merge those here
// since the walker reports each line-comment separately).
//
// The previous hand-rolled lexer walked the source line-by-line
// tracking `/*` / `*/` state and `//` runs. The AST walker does the
// state-tracking for us (it knows about string-literal regions, so a
// `//` inside a string doesn't get mistaken for a comment opener).
export function extractCommentBlocks(source: string): Comment[] {
  const all = walkComments(source, { comments: true })
  const blocks: Comment[] = []
  let lineRunStartLine: number | undefined
  let lineRunStartOffset: number | undefined
  let lineRunEnd: number | undefined
  let lineRunBuf: string[] = []
  const flushLineRun = (): void => {
    if (lineRunStartLine === undefined || lineRunBuf.length === 0) {
      return
    }
    blocks.push({
      text: lineRunBuf.join('\n').trim(),
      lineNumber: lineRunStartLine,
    })
    lineRunStartLine = undefined
    lineRunStartOffset = undefined
    lineRunEnd = undefined
    lineRunBuf = []
  }
  for (let i = 0; i < all.length; i += 1) {
    const c = all[i]!
    if (c.kind === 'Line') {
      // Contiguous if there's no significant content between the prior
      // line-comment's end and this one's start. We approximate by
      // checking the prior end is followed only by whitespace + a
      // single newline, and the next non-whitespace position is `//`.
      const adjacent =
        lineRunEnd !== undefined &&
        /^[\t \r]*\n[\t ]*\/\//.test(source.slice(lineRunEnd, c.start + 2))
      if (!adjacent) {
        flushLineRun()
      }
      if (lineRunStartLine === undefined) {
        lineRunStartLine = c.line
        lineRunStartOffset = c.start
      }
      lineRunBuf.push(c.value.trimStart())
      lineRunEnd = c.end
      continue
    }
    // Block comment — flush any pending line-run first, then add the
    // block as its own entry with leading `*` decorators stripped per
    // line.
    flushLineRun()
    const cleaned = splitLines(c.value)
      .map(l => l.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim()
    if (cleaned) {
      blocks.push({ text: cleaned, lineNumber: c.line })
    }
  }
  flushLineRun()
  // lineRunStartOffset is kept for symmetry with the line-run merge
  // window; we don't currently expose it on Comment.
  void lineRunStartOffset
  return blocks
}

interface Hit {
  readonly lineNumber: number
  readonly preview: string
}

export function findPointerOnlyComments(blocks: readonly Comment[]): Hit[] {
  const hits: Hit[] = []
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    const text = block.text.trim()
    if (text.length === 0) {
      continue
    }
    if (!POINTER_OPENERS_RE.test(text)) {
      continue
    }
    // Block opens with a pointer phrase. Check whether the WHOLE block
    // ALSO carries a claim shape. If it does, we pass.
    if (CLAIM_SHAPE_RE.test(text)) {
      continue
    }
    // Pointer-only. Flag.
    const preview = text.replace(/\s+/g, ' ').slice(0, 100)
    hits.push({ lineNumber: block.lineNumber, preview })
  }
  return hits
}

export const hook = defineHook({
  bypass: ['pointer-comment'],
  bypassOptional: true,
  check: editGuard((filePath, content) => {
    const normalizedFilePath = normalizePath(filePath)
    if (!SOURCE_EXT_RE.test(normalizedFilePath)) {
      return undefined
    }
    // Skip tests — they often have illustrative pointer-only comments.
    if (
      /(?:^|\/)test\//.test(normalizedFilePath) ||
      /\.test\.[jt]sx?$/.test(normalizedFilePath)
    ) {
      return undefined
    }
    const text = content ?? ''
    if (!text) {
      return undefined
    }
    const blocks = extractCommentBlocks(text)
    const hits = findPointerOnlyComments(blocks)
    if (hits.length === 0) {
      return undefined
    }

    const lines = [
      `[pointer-comment-nudge] Pointer-only comment(s) detected in ${filePath}:`,
      '',
    ]
    for (let i = 0, { length } = hits; i < length; i += 1) {
      const h = hits[i]!
      lines.push(
        `  • line ${h.lineNumber}: "${h.preview}${h.preview.length === 100 ? '…' : ''}"`,
      )
    }
    lines.push('')
    lines.push(
      '  Per CLAUDE.md "Code style → Pointer comments": a pointer comment',
    )
    lines.push(
      '  must carry a one-line claim explaining the decision, so a reader',
    )
    lines.push(
      '  who never follows the pointer still walks away with the *why*.',
    )
    lines.push('')
    lines.push('  Bad:')
    lines.push('    // See the @fileoverview JSDoc above.')
    lines.push('')
    lines.push('  Good:')
    lines.push('    // See the @fileoverview JSDoc above.')
    lines.push("    // V8's existing hot path beats trampoline overhead here.")
    lines.push('')
    return notify(lines.join('\n') + '\n')
  }),
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
