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
 * Is any canonical bypass phrase present in a recent user turn?
 * Substring match, case-sensitive (intentional — `allow X bypass`
 * lowercase doesn't count, matches the fleet rule stated in
 * docs/claude.md/bypass-phrases.md).
 *
 * Accepts a string or string[] so callers with a single canonical
 * spelling and callers with equivalent spellings (e.g. "soaktime" /
 * "soak time" / "soak-time") share the same helper. The transcript
 * is read once; each phrase substring-checks against the same text.
 */
export function bypassPhrasePresent(
  transcriptPath: string | undefined,
  phrases: string | readonly string[],
  lookbackUserTurns?: number | undefined,
): boolean {
  const list = typeof phrases === 'string' ? [phrases] : phrases
  const { length } = list
  if (length === 0) {
    return false
  }
  const text = readUserText(transcriptPath, lookbackUserTurns)
  if (!text) {
    return false
  }
  for (let i = 0; i < length; i += 1) {
    if (text.includes(list[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Strip fenced code blocks (```…```) and inline code (`…`) from a text
 * snapshot before pattern-matching. Assistant prose frequently quotes
 * phrases as code examples (`` `out of scope` ``) which would otherwise
 * false-positive phrase detectors. Cheap to run: two regex passes,
 * O(n) over the input.
 */
export function stripCodeFences(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
}

/**
 * Inverse of `stripCodeFences`: extract the contents of fenced code
 * blocks. Returns each block's body (the lines between the opening
 * and closing fence) as a separate string. The leading language tag
 * (e.g. ```` ```ts ````) is stripped — only the code lines are kept.
 *
 * Used by hooks (error-message-quality-reminder) that need to inspect
 * the code the assistant wrote rather than the prose around it.
 */
export function extractCodeFences(text: string): string[] {
  const out: string[] = []
  // Match ```optional-lang\n...code...\n```
  // The lang tag is optional; the content is anything (non-greedy) up
  // to the closing fence. We're permissive — bad markdown still gets
  // captured as a block.
  const re = /```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const body = match[1]
    if (body !== undefined) {
      out.push(body)
    }
  }
  return out
}

/**
 * Shape of a tool-use event extracted from an assistant turn. The
 * harness emits these as content blocks with `type: 'tool_use'`,
 * carrying the tool name (e.g. 'Write', 'Edit', 'Bash') and the
 * structured `input` object passed to that tool.
 *
 * Inputs are intentionally typed `Record<string, unknown>` because
 * each tool has its own schema and we don't want to enumerate them
 * here. Callers narrow on `name` and inspect the fields they care
 * about (e.g. `input.file_path` for Write/Edit).
 */
export interface ToolUseEvent {
  readonly name: string
  readonly input: Record<string, unknown>
}

/**
 * Extract tool-use blocks from a single turn's content array. Skips
 * non-tool-use blocks (text, etc.) and ignores malformed entries.
 */
function extractToolUseBlocks(content: unknown): ToolUseEvent[] {
  if (!Array.isArray(content)) {
    return []
  }
  const out: ToolUseEvent[] = []
  for (let i = 0, { length } = content; i < length; i += 1) {
    const block = content[i]
    if (!block || typeof block !== 'object') {
      continue
    }
    const b = block as Record<string, unknown>
    if (b['type'] !== 'tool_use') {
      continue
    }
    const name = typeof b['name'] === 'string' ? b['name'] : undefined
    const input = b['input']
    if (!name || !input || typeof input !== 'object') {
      continue
    }
    out.push({ name, input: input as Record<string, unknown> })
  }
  return out
}

/**
 * Walk the transcript newest → oldest, return every tool-use event
 * from the most recent assistant turn. Returns an empty array if the
 * transcript is missing or the most recent assistant turn has no
 * tool uses. Used by hooks that gate on what the assistant just did
 * (e.g. file-size-reminder reading Write/Edit events).
 */
export function readLastAssistantToolUses(
  transcriptPath: string | undefined,
): readonly ToolUseEvent[] {
  const lines = readLines(transcriptPath)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (!r || r.role !== 'assistant') {
      continue
    }
    return extractToolUseBlocks(r.content)
  }
  return []
}
