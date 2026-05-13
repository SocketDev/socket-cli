/**
 * @fileoverview Shared helpers for Claude Code PreToolUse / Stop hooks.
 *
 * Two responsibilities the fleet's hooks were each duplicating:
 *
 *   1. `readStdin()` — pull the JSON payload Claude Code sends on
 *      stdin. Always the same shape, always the same code.
 *
 *   2. `bypassPhrasePresent()` / `readUserText()` — scan the
 *      conversation transcript JSONL for a canonical `Allow <X>
 *      bypass` phrase. The transcript format has 3 variant shapes
 *      across harness versions; centralizing the parser means a
 *      schema change is a one-file fix.
 *
 * Why one file: KISS. Both helpers want the same imports
 * (`node:fs` + the JSONL parser); separating into two files would
 * just shuffle imports. The file is small (~100 LOC) so cohesion
 * wins.
 *
 * Fail-open contract: every helper here returns a safe default on
 * any parse / I/O error rather than throwing. A hook that crashes
 * blocks every Claude Code call indefinitely; one that returns
 * "no bypass present" or "empty user text" simply falls through to
 * the hook's default decision. Per the fleet's hook contract: "a
 * buggy hook silently allows" is preferable to "a buggy hook wedges
 * the session."
 */

import { existsSync, readFileSync } from 'node:fs'

/**
 * Read the entire stdin buffer into a string. Used by every
 * PreToolUse hook to slurp the JSON payload Claude Code sends.
 */
export function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf))
  })
}

type Role = 'user' | 'assistant'

/**
 * Extract this turn's text content into a flat array of pieces. Handles
 * the 3 content shapes the harness emits (string / array-of-blocks /
 * nested message.content).
 */
function extractTurnPieces(content: unknown): string[] {
  const pieces: string[] = []
  if (typeof content === 'string') {
    pieces.push(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'string') {
        pieces.push(block)
      } else if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        if (typeof b['text'] === 'string') {
          pieces.push(b['text'])
        } else if (typeof b['content'] === 'string') {
          pieces.push(b['content'])
        }
      }
    }
  }
  return pieces
}

/**
 * Resolve a JSONL event's role (`'user'` / `'assistant'`) and content
 * tolerantly across the 3 variant shapes seen in harness versions:
 *
 *   { role: 'user', content: '...' }
 *   { type: 'user', message: { role: 'user', content: '...' } }
 *   { type: 'user', message: { content: [{ type: 'text', text: '...' }] } }
 *
 * Returns undefined for malformed events so the caller can skip cleanly.
 */
function resolveRoleAndContent(evt: unknown): {
  content: unknown
  role: string | undefined
} | undefined {
  if (!evt || typeof evt !== 'object') {
    return undefined
  }
  const e = evt as Record<string, unknown>
  const role =
    typeof e['role'] === 'string'
      ? e['role']
      : typeof e['type'] === 'string'
        ? e['type']
        : undefined
  const message = e['message']
  const content =
    e['content'] ??
    (message && typeof message === 'object'
      ? (message as Record<string, unknown>)['content']
      : undefined)
  return { content, role }
}

/**
 * Read the transcript JSONL file into newline-filtered lines. Returns
 * an empty array on missing path or read error — every caller in this
 * module wants the same empty-on-failure semantics.
 */
function readLines(transcriptPath: string | undefined): string[] {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return []
  }
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  return raw.split('\n').filter(Boolean)
}

/**
 * Generic turn-walker: walk the transcript newest → oldest, collecting
 * text from turns whose role matches `role`. Joins all turns'
 * pieces with newlines and returns chronological order at the end.
 *
 * `lookback` (optional) limits the search to the most-recent N
 * matching turns so callers don't pay the full-transcript cost when
 * they only need recent context.
 */
function readRoleText(
  transcriptPath: string | undefined,
  role: Role,
  lookback?: number | undefined,
): string {
  const lines = readLines(transcriptPath)
  const out: string[] = []
  let matched = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (!r || r.role !== role) {
      continue
    }
    const pieces = extractTurnPieces(r.content)
    if (pieces.length) {
      // Buffer this turn's blocks together so the final reverse swaps
      // *turn order*, not intra-turn block order.
      out.push(pieces.join('\n'))
    }
    matched += 1
    if (lookback !== undefined && matched >= lookback) {
      break
    }
  }
  // Reverse to chronological order so substring matches that span
  // multiple turns (rare) read naturally.
  return out.reverse().join('\n')
}

/**
 * Read every user-turn text content from a transcript JSONL, joined
 * by newlines. Returns empty string when the path is unset, missing,
 * or unparseable. `lookbackUserTurns` limits to the most-recent N user
 * turns (counted from the tail); omit to read all turns.
 */
export function readUserText(
  transcriptPath: string | undefined,
  lookbackUserTurns?: number | undefined,
): string {
  return readRoleText(transcriptPath, 'user', lookbackUserTurns)
}

/**
 * Read the most-recent assistant-turn text content. Same shape parser
 * as `readUserText`; used by hooks (excuse-detector) that scan what
 * the assistant just said rather than what the user typed.
 */
export function readLastAssistantText(
  transcriptPath: string | undefined,
): string {
  return readRoleText(transcriptPath, 'assistant', 1)
}

/**
 * Convenience predicate: is the canonical bypass phrase present in
 * any recent user turn? Substring match, case-sensitive (intentional —
 * `allow X bypass` lowercase doesn't count, matches the fleet rule
 * stated in docs/claude.md/bypass-phrases.md).
 */
export function bypassPhrasePresent(
  transcriptPath: string | undefined,
  phrase: string,
  lookbackUserTurns?: number | undefined,
): boolean {
  return readUserText(transcriptPath, lookbackUserTurns).includes(phrase)
}
