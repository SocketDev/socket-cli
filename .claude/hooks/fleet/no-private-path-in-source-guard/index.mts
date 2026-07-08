#!/usr/bin/env node
// Claude Code PreToolUse hook — no-private-path-in-source-guard.
//
// Blocks an Edit/Write/MultiEdit that introduces an INTERNAL / PRIVATE path
// reference into a SOURCE file's COMMENT. The incident: an agent leaked a
// plans-directory path into a public napi-rs source file (`crates/.../src/lib.rs`).
// That discloses internal fleet repo layout, an operator-local working-notes path,
// and a dev-box checkout location to anyone reading the shipped source.
//
// Detected inside comment syntax (NOT inside strings or real code):
//   - untracked plans/reports directory paths — untracked operator notes.
//   - `socket-<repo>/.claude/…` — another fleet repo's private tree.
//   - `/Users/<name>/…` — an absolute home path (username + local layout).
//   - `../socket-<repo>/…` — a sibling fleet-repo relative path (dev-box layout).
//
// Scope: SOURCE-CODE files only (.rs/.ts/.mts/.js/.go/.py/.c/.h/…). Markdown,
// docs, JSON/YAML, and the `.claude/` tree itself are NOT checked — those
// surfaces legitimately reference these paths (a plan doc names a plan path).
//
// Public-surface-hygiene adjacent — pairs with private-name-nudge /
// public-surface-nudge / the no-cross-repo-relative-paths rule.
//
// Bypass phrase: `Allow private-path-in-source bypass`.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write"|"MultiEdit",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass (not Edit/Write, non-source file, no private path in a comment).
//   2 — block (a private path appears inside a source comment).
//
// Fails open on malformed payloads (exit 0).

import { splitLines, walkComments } from '../_shared/acorn/index.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import type { PrivatePathFinding } from '../_shared/private-paths.mts'
import {
  describePrivatePathKind,
  extractLexicalCommentBodies,
  matchPrivatePath,
  scanCommentBodyLines,
} from '../_shared/private-paths.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow private-path-in-source bypass'
const BYPASS_LOOKBACK_USER_TURNS = 8

// Source-code extensions whose COMMENTS we scan. Markdown / docs / JSON / YAML
// and the `.claude/` tree are deliberately excluded — they reference these
// paths legitimately.
const SOURCE_FILE_RE =
  /\.(?:[cm]?[jt]sx?|cc|cpp|cxx|hpp|hh|[ch]|rs|go|py|rb|java|kt|swift|sh|bash|zsh)$/

const JS_TS_FILE_RE = /\.(?:[cm]?[jt]sx?)$/

/**
 * Push one finding per matching comment-body line into `findings`. Shared by
 * the two non-AST scan paths (block-span body and line-comment body) so the
 * lexical walker stays DRY.
 */
function pushMatch(
  findings: PrivatePathFinding[],
  body: string,
  rawLine: string,
  lineNum: number,
): void {
  const hit = matchPrivatePath(body)
  if (hit) {
    findings.push({
      __proto__: null,
      kind: hit.kind,
      line: lineNum,
      snippet: rawLine.trim(),
      match: hit.match,
    } as PrivatePathFinding)
  }
}

/**
 * AST-based detector for JS/TS/JSX/TSX. Walks just the comment tokens via the
 * shared acorn helper, so a private path inside a string literal or real code
 * never triggers.
 */
export function findPrivatePathsAst(text: string): PrivatePathFinding[] {
  const findings: PrivatePathFinding[] = []
  for (const c of walkComments(text, { comments: true })) {
    const bodyLines = splitLines(c.value).map(l => l.replace(/^\s*\*\s?/, ''))
    findings.push(...scanCommentBodyLines(bodyLines, c.line))
  }
  return findings
}

/**
 * Lexical detector for non-JS sources (Rust, Go, Python, C, shell, …). Defers
 * the comment-body extraction (block spans, single-line `/* … *\/`, line
 * comments) to the shared `extractLexicalCommentBodies` so the hook and the
 * commit-time check can never drift; only comment text reaches the matcher.
 */
export function findPrivatePathsLexical(text: string): PrivatePathFinding[] {
  const findings: PrivatePathFinding[] = []
  const lines = splitLines(text)
  for (const { body, line } of extractLexicalCommentBodies(text)) {
    /* c8 ignore next - splitLines always produces >= as many lines as extractLexicalCommentBodies, so lines[line-1] is always defined; this is a defensive fallback */
    pushMatch(findings, body, lines[line - 1] ?? body, line)
  }
  return findings
}

/**
 * Detect private-path references inside the comments of `text`, dispatching to
 * the AST walker for JS/TS and the lexical scanner otherwise.
 */
export function findPrivatePaths(
  text: string,
  filePath: string,
): PrivatePathFinding[] {
  return JS_TS_FILE_RE.test(filePath)
    ? findPrivatePathsAst(text)
    : findPrivatePathsLexical(text)
}

export const check = editGuard((filePath, content, payload) => {
  if (!SOURCE_FILE_RE.test(filePath)) {
    return undefined
  }
  const text = content ?? ''
  if (!text) {
    return undefined
  }
  const findings = findPrivatePaths(text, filePath)
  if (findings.length === 0) {
    return undefined
  }
  if (
    bypassPhrasePresent(
      payload.transcript_path,
      BYPASS_PHRASE,
      BYPASS_LOOKBACK_USER_TURNS,
    )
  ) {
    return undefined
  }
  const lines: string[] = []
  lines.push(
    '🚨 no-private-path-in-source-guard: blocked a private/internal path in a source comment.',
  )
  lines.push(`  File: ${filePath}`)
  lines.push('')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  Line ${f.line} — ${describePrivatePathKind(f.kind)}:`)
    lines.push(`    Saw:   ${f.snippet}`)
    lines.push(`    Match: ${f.match}`)
    lines.push('')
  }
  lines.push(
    '  These references leak internal fleet layout, operator-local working',
  )
  lines.push(
    '  notes, or a dev-box checkout path into committed (often public) source.',
  )
  lines.push('')
  lines.push(
    '  Fix: remove the path from the comment. If you need to explain a',
  )
  lines.push(
    '  decision, describe the constraint — not where a plan doc lives.',
  )
  lines.push('')
  lines.push('  Background: docs/agents.md/fleet/public-surface-hygiene.md')
  lines.push('')
  lines.push(
    `  One-shot bypass (rare): user types "${BYPASS_PHRASE}" verbatim in a recent message.`,
  )
  return block(lines.join('\n') + '\n')
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
