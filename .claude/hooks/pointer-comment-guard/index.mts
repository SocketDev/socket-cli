#!/usr/bin/env node
// Claude Code PreToolUse hook — pointer-comment-guard.
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
// SOCKET_POINTER_COMMENT_GUARD_DISABLED=1.

import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface PreToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?:
    | {
        readonly file_path?: unknown
        readonly content?: unknown
        readonly new_string?: unknown
      }
    | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASES = [
  'Allow pointer-comment bypass',
  'Allow pointer comment bypass',
  'Allow pointercomment bypass',
] as const

const SOURCE_EXT_RE = /\.(?:m|c)?[jt]sx?$/

// A line is a "comment" line if it starts (after optional whitespace
// and `*` for block-comment continuation) with `//` or is inside a
// `/* … */` block. We normalize comment groups before scanning.
//
// A pointer phrase opens with one of these patterns. They are the
// canonical "see X" / "rationale in Y" shapes — narrow enough to
// avoid false positives on prose like "I'll see if this works."
const POINTER_OPENERS_RE =
  /^(?:see\b|full rationale in\b|rationale in\b|details in\b|documented in\b|defined in\b|described in\b|specified in\b|reference[sd]? in\b)/i

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

// Split source into comment blocks. A "block" is one logical comment:
// a `/* … */` span, or a run of consecutive `//` lines. Returns each
// block as a single string (with `//` / `*` markers stripped) plus
// the 1-based line number where the block opens.
function extractCommentBlocks(source: string): Comment[] {
  const lines = source.split('\n')
  const blocks: Comment[] = []
  let inBlock = false
  let buf: string[] = []
  let bufStart = 0
  let lineRun: string[] = []
  let lineRunStart = 0

  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (inBlock) {
      const endIdx = trimmed.indexOf('*/')
      if (endIdx === -1) {
        buf.push(trimmed.replace(/^\*\s?/, ''))
      } else {
        buf.push(trimmed.slice(0, endIdx).replace(/^\*\s?/, ''))
        blocks.push({ text: buf.join('\n').trim(), lineNumber: bufStart })
        buf = []
        inBlock = false
      }
      continue
    }
    if (trimmed.startsWith('/*')) {
      // Single-line /* … */ block.
      const endIdx = trimmed.indexOf('*/', 2)
      if (endIdx !== -1) {
        const inner = trimmed.slice(2, endIdx).trim()
        if (inner) {
          blocks.push({ text: inner, lineNumber: i + 1 })
        }
      } else {
        inBlock = true
        bufStart = i + 1
        buf.push(trimmed.slice(2).replace(/^\*\s?/, ''))
      }
      continue
    }
    if (trimmed.startsWith('//')) {
      const content = trimmed.slice(2).trimStart()
      if (lineRun.length === 0) {
        lineRunStart = i + 1
      }
      lineRun.push(content)
      continue
    }
    if (lineRun.length > 0) {
      blocks.push({ text: lineRun.join('\n').trim(), lineNumber: lineRunStart })
      lineRun = []
    }
  }
  if (lineRun.length > 0) {
    blocks.push({ text: lineRun.join('\n').trim(), lineNumber: lineRunStart })
  }
  return blocks
}

interface Hit {
  readonly lineNumber: number
  readonly preview: string
}

function findPointerOnlyComments(blocks: readonly Comment[]): Hit[] {
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

async function main(): Promise<void> {
  if (process.env['SOCKET_POINTER_COMMENT_GUARD_DISABLED']) {
    process.exit(0)
  }
  const payloadRaw = await readStdin()
  let payload: PreToolUsePayload
  try {
    payload = JSON.parse(payloadRaw) as PreToolUsePayload
  } catch {
    process.exit(0)
  }
  const tool = payload.tool_name
  if (tool !== 'Edit' && tool !== 'Write') {
    process.exit(0)
  }
  const filePath = payload.tool_input?.['file_path']
  if (typeof filePath !== 'string') {
    process.exit(0)
  }
  if (!SOURCE_EXT_RE.test(filePath)) {
    process.exit(0)
  }
  // Skip tests — they often have illustrative pointer-only comments.
  if (/(^|\/)test\//.test(filePath) || /\.test\.[jt]sx?$/.test(filePath)) {
    process.exit(0)
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)) {
    process.exit(0)
  }
  const content =
    typeof payload.tool_input?.['content'] === 'string'
      ? (payload.tool_input!['content'] as string)
      : typeof payload.tool_input?.['new_string'] === 'string'
        ? (payload.tool_input!['new_string'] as string)
        : ''
  if (!content) {
    process.exit(0)
  }
  const blocks = extractCommentBlocks(content)
  const hits = findPointerOnlyComments(blocks)
  if (hits.length === 0) {
    process.exit(0)
  }

  const lines = [
    `[pointer-comment-guard] Pointer-only comment(s) detected in ${filePath}:`,
    '',
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(`  • line ${h.lineNumber}: "${h.preview}${h.preview.length === 100 ? '…' : ''}"`)
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
  lines.push(
    '  Bypass: "Allow pointer-comment bypass" in a recent user message,',
  )
  lines.push('  or SOCKET_POINTER_COMMENT_GUARD_DISABLED=1.')
  lines.push('')
  process.stderr.write(lines.join('\n') + '\n')
  // Informational — exit 0. The hook leaves the breadcrumb in stderr
  // for the next turn to read; it doesn't block the edit.
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
