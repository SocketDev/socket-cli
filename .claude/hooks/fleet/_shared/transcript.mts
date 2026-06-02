/**
 * @file Shared helpers for Claude Code PreToolUse / Stop hooks. Two
 *   responsibilities the fleet's hooks were each duplicating:
 *
 *   1. `readStdin()` — pull the JSON payload Claude Code sends on stdin. Always
 *      the same shape, always the same code.
 *   2. `bypassPhrasePresent()` / `readUserText()` — scan the conversation
 *      transcript JSONL for a canonical `Allow <X> bypass` phrase. The
 *      transcript format has 3 variant shapes across harness versions;
 *      centralizing the parser means a schema change is a one-file fix. Why one
 *      file: KISS. Both helpers want the same imports (`node:fs` + the JSONL
 *      parser); separating into two files would just shuffle imports. The file
 *      is small (~100 LOC) so cohesion wins. Fail-open contract: every helper
 *      here returns a safe default on any parse / I/O error rather than
 *      throwing. A hook that crashes blocks every Claude Code call
 *      indefinitely; one that returns "no bypass present" or "empty user text"
 *      simply falls through to the hook's default decision. Per the fleet's
 *      hook contract: "a buggy hook silently allows" is preferable to "a buggy
 *      hook wedges the session."
 */

import { existsSync, readFileSync } from 'node:fs'

/**
 * Is any canonical bypass phrase present in a recent user turn? Substring
 * match, case-sensitive (intentional — `allow X bypass` lowercase doesn't
 * count, matches the fleet rule stated in docs/claude.md/bypass-phrases.md).
 *
 * Accepts a string or string[] so callers with a single canonical spelling and
 * callers with equivalent spellings (e.g. "soaktime" / "soak time" /
 * "soak-time") share the same helper. The transcript is read once; each phrase
 * substring-checks against the same text.
 *
 * Use this when the bypass is **broad** — one phrase authorizes any matching
 * action for the rest of the conversation window. For **per-trigger**
 * authorization (one phrase = one action), use `bypassPhraseRemaining` instead
 * so a single phrase doesn't open the door for a follow-up action of the same
 * shape later.
 */
/**
 * Normalize a bypass phrase / haystack so hyphens and runs of whitespace
 * collapse to a single space. `Allow workflow-scope bypass`, `Allow workflow
 * scope bypass`, and `Allow workflow—scope bypass` all collapse to the same
 * canonical form for matching. The transcript-reading helpers run user text
 * through this so minor punctuation variations don't break the bypass match.
 */
function normalizeBypassText(text: string): string {
  // NFKC: canonical-decompose + compose + compatibility-fold so
  // visually-similar variants collapse — smart quotes, full-width,
  // ligatures all map to ASCII-canonical.
  // \p{Cf} strip: format / zero-width / bidi-override chars are removed
  // so an attacker can't inject a benign-rendering turn that contains
  // the bypass phrase only after invisible chars are stripped — nor
  // can a user accidentally type a phrase that fails to match because
  // an editor inserted a zero-width-space.
  // toLowerCase: matching is case-INsensitive — `allow fleet-fork bypass`
  // and `ALLOW FLEET-FORK BYPASS` count the same as the canonical mixed
  // case. Typing the phrase is already a deliberate act; casing carries no
  // extra signal, and requiring exact case just trips up a hurried user.
  // Combined with the dash/whitespace fold below, only the words + their
  // order are load-bearing.
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[-—–\s]+/g, ' ')
    .toLowerCase()
}

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
  const haystack = normalizeBypassText(text)
  for (let i = 0; i < length; i += 1) {
    const needle = normalizeBypassText(list[i]!)
    if (haystack.includes(needle)) {
      return true
    }
  }
  return false
}

/**
 * Returns the count of bypass phrases NOT YET CONSUMED by prior actions. The
 * caller supplies `priorActionCount` — usually a count of past tool-use
 * invocations that would have consumed a phrase if it had been present. The
 * phrase budget is replenished by every fresh user-typed occurrence.
 *
 * Remaining = phraseCount - priorActionCount remaining > 0 → caller may proceed
 * (one slot consumed by this action) remaining <= 0 → caller must block; phrase
 * budget exhausted.
 *
 * Per-trigger semantics: a single `Allow X bypass` authorizes exactly one
 * action of the gated shape. To do a second, the user types the phrase again.
 *
 * For workflow_dispatch and similar "name the target" bypasses, the phrase
 * format is `Allow <action> bypass: <target>` and the caller passes only
 * target-matching phrases.
 */
export function bypassPhraseRemaining(
  transcriptPath: string | undefined,
  phrases: string | readonly string[],
  priorActionCount: number,
  lookbackUserTurns?: number | undefined,
): number {
  const phraseCount = countBypassPhrases(
    transcriptPath,
    phrases,
    lookbackUserTurns,
  )
  return phraseCount - priorActionCount
}

/**
 * Count the number of bypass-phrase occurrences in recent user turns. Each
 * occurrence is a separate authorization slot — the user typing the phrase
 * twice authorizes two actions, not one.
 *
 * Substring-counted, non-overlapping (each match consumes its own span of
 * characters), case-sensitive. Multiple accepted spellings (`phrases:
 * string[]`) each contribute their own count.
 *
 * Use with `bypassPhraseRemaining(...) > 0` to gate one-time bypasses where the
 * hook also tracks prior consumption (e.g. count of prior workflow_dispatch
 * invocations of the same workflow in the assistant tool-use history).
 */
export function countBypassPhrases(
  transcriptPath: string | undefined,
  phrases: string | readonly string[],
  lookbackUserTurns?: number | undefined,
): number {
  const list = typeof phrases === 'string' ? [phrases] : phrases
  const { length } = list
  if (length === 0) {
    return 0
  }
  const rawText = readUserText(transcriptPath, lookbackUserTurns)
  if (!rawText) {
    return 0
  }
  // Normalize hyphens / em-dashes / runs of whitespace to single
  // spaces so `Allow workflow-scope bypass` and `Allow workflow scope
  // bypass` match the same phrase. Indices below run in the
  // normalized string's coordinate space.
  const text = normalizeBypassText(rawText)
  // Track which `[start, end)` spans were already counted by a prior
  // phrase so a shorter phrase that's a substring of a longer one
  // doesn't double-count (e.g. `Allow workflow-dispatch bypass: build`
  // shouldn't match again inside `Allow workflow-dispatch bypass:
  // build.yml`). Sort longest-first so the more specific phrase
  // claims the span first.
  const sorted = [...list]
    .filter(p => p)
    .map(p => normalizeBypassText(p))
    .toSorted((a, b) => b.length - a.length)
  const claimed: Array<[number, number]> = []
  let total = 0
  for (let i = 0, sortedLen = sorted.length; i < sortedLen; i += 1) {
    const phrase = sorted[i]!
    let idx = 0
    while ((idx = text.indexOf(phrase, idx)) !== -1) {
      const start = idx
      const end = idx + phrase.length
      const overlaps = claimed.some(([cs, ce]) => start < ce && end > cs)
      if (!overlaps) {
        // Word-boundary check on the trailing edge: the char right
        // after `end` must not be an identifier char (alnum / . / -),
        // otherwise we matched a prefix of a longer token (e.g.
        // "build" inside "build.yml" without the longer phrase
        // having claimed it for whatever reason).
        const next = text.charCodeAt(end)
        // 0–9 (48–57), A–Z (65–90), a–z (97–122), `-` (45), `.` (46), `_` (95)
        const isIdentChar =
          (next >= 48 && next <= 57) ||
          (next >= 65 && next <= 90) ||
          (next >= 97 && next <= 122) ||
          next === 45 ||
          next === 46 ||
          next === 95
        if (!isIdentChar) {
          total += 1
          claimed.push([start, end])
        }
      }
      idx = end
    }
  }
  return total
}

/**
 * Inverse of `stripCodeFences`: extract the contents of fenced code blocks.
 * Returns each block's body (the lines between the opening and closing fence)
 * as a separate string. The leading language tag (e.g. ` ```ts `) is stripped —
 * only the code lines are kept.
 *
 * Used by hooks (error-message-quality-reminder) that need to inspect the code
 * the assistant wrote rather than the prose around it.
 */
export interface CodeFence {
  lang: string
  body: string
}

export function extractCodeFences(text: string): CodeFence[] {
  const out: CodeFence[] = []
  // Match ```optional-lang\n...code...\n```
  // The lang tag is optional; the content is anything (non-greedy) up
  // to the closing fence. We're permissive — bad markdown still gets
  // captured as a block.
  const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const body = match[2]
    if (body !== undefined) {
      out.push({ lang: match[1] ?? '', body })
    }
  }
  return out
}

/**
 * Shape of a tool-use event extracted from an assistant turn. The harness emits
 * these as content blocks with `type: 'tool_use'`, carrying the tool name (e.g.
 * 'Write', 'Edit', 'Bash') and the structured `input` object passed to that
 * tool.
 *
 * Inputs are intentionally typed `Record<string, unknown>` because each tool
 * has its own schema and we don't want to enumerate them here. Callers narrow
 * on `name` and inspect the fields they care about (e.g. `input.file_path` for
 * Write/Edit).
 */
export interface ToolUseEvent {
  readonly name: string
  readonly input: Record<string, unknown>
}

/**
 * Extract tool-use blocks from a single turn's content array. Skips
 * non-tool-use blocks (text, etc.) and ignores malformed entries.
 */
export function extractToolUseBlocks(content: unknown): ToolUseEvent[] {
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

type Role = 'user' | 'assistant'

/**
 * Extract this turn's text content into a flat array of pieces. Handles the 3
 * content shapes the harness emits (string / array-of-blocks / nested
 * message.content).
 */
export function extractTurnPieces(content: unknown): string[] {
  const pieces: string[] = []
  if (typeof content === 'string') {
    pieces.push(content)
  } else if (Array.isArray(content)) {
    for (let i = 0, { length } = content; i < length; i += 1) {
      const block = content[i]!
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
 * Read the most-recent assistant-turn text content. Same shape parser as
 * `readUserText`; used by hooks (excuse-detector) that scan what the assistant
 * just said rather than what the user typed.
 */
export function readLastAssistantText(
  transcriptPath: string | undefined,
): string {
  return readRoleText(transcriptPath, 'assistant', 1)
}

/**
 * Walk the transcript newest → oldest, return every tool-use event from the
 * most recent assistant turn. Returns an empty array if the transcript is
 * missing or the most recent assistant turn has no tool uses. Used by hooks
 * that gate on what the assistant just did (e.g. file-size-reminder reading
 * Write/Edit events).
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

/**
 * Walk the transcript newest → oldest, return tool-use events from the
 * **prior** assistant turns (skipping the most-recent one). `lookback` caps how
 * far back to walk in assistant turns; pass a small N (e.g. 5) so the scan
 * stays cheap on long transcripts. Used by hooks that compare what the
 * assistant is doing now to what it did earlier in the session — e.g.
 * compound-lessons-reminder detecting repeated edits to the same hook/skill
 * without rule promotion.
 */
export function readPriorAssistantToolUses(
  transcriptPath: string | undefined,
  lookback: number,
): readonly ToolUseEvent[] {
  const lines = readLines(transcriptPath)
  const out: ToolUseEvent[] = []
  let assistantTurnsSeen = 0
  let skippedMostRecent = false
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
    if (!skippedMostRecent) {
      skippedMostRecent = true
      continue
    }
    const events = extractToolUseBlocks(r.content)
    for (let j = 0, { length } = events; j < length; j += 1) {
      out.push(events[j]!)
    }
    assistantTurnsSeen += 1
    if (assistantTurnsSeen >= lookback) {
      break
    }
  }
  return out
}

/**
 * Read the transcript JSONL file into newline-filtered lines. Returns an empty
 * array on missing path or read error — every caller in this module wants the
 * same empty-on-failure semantics.
 */
export function readLines(transcriptPath: string | undefined): string[] {
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
 * Generic turn-walker: walk the transcript newest → oldest, collecting text
 * from turns whose role matches `role`. Joins all turns' pieces with newlines
 * and returns chronological order at the end.
 *
 * `lookback` (optional) limits the search to the most-recent N matching turns
 * so callers don't pay the full-transcript cost when they only need recent
 * context.
 */
export function readRoleText(
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
  return out.toReversed().join('\n')
}

/**
 * Read the entire stdin buffer into a string. Used by every PreToolUse hook to
 * slurp the JSON payload Claude Code sends.
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

/**
 * Read every user-turn text content from a transcript JSONL, joined by
 * newlines. Returns empty string when the path is unset, missing, or
 * unparseable. `lookbackUserTurns` limits to the most-recent N user turns
 * (counted from the tail); omit to read all turns.
 */
export function readUserText(
  transcriptPath: string | undefined,
  lookbackUserTurns?: number | undefined,
): string {
  return readRoleText(transcriptPath, 'user', lookbackUserTurns)
}

/**
 * Resolve a JSONL event's role (`'user'` / `'assistant'`) and content
 * tolerantly across the 3 variant shapes seen in harness versions:
 *
 * { role: 'user', content: '...' } { type: 'user', message: { role: 'user',
 * content: '...' } } { type: 'user', message: { content: [{ type: 'text', text:
 * '...' }] } }
 *
 * Returns undefined for malformed events so the caller can skip cleanly.
 */
export function resolveRoleAndContent(evt: unknown):
  | {
      content: unknown
      role: string | undefined
    }
  | undefined {
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
 * Strip fenced code blocks (`…`) and inline code (`…`) from a text snapshot
 * before pattern-matching. Assistant prose frequently quotes phrases as code
 * examples (`` `out of scope` ``) which would otherwise false-positive phrase
 * detectors. Cheap to run: two regex passes, O(n) over the input.
 */
export function stripCodeFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ')
}

/**
 * Strip text that's clearly _quoted_ rather than asserted — i.e. text the
 * assistant is referring to as a phrase, not using as one. Used by Stop hooks
 * that scan for excuse phrases: a summary like when Claude says "pre-existing",
 * … the hook now blocks mentions the trigger but isn't an excuse. Without this
 * strip, the hook self-fires every time it explains itself.
 *
 * Heuristic: strip the contents of paired ASCII double-quotes (`"…"`), paired
 * smart double-quotes (`"…"`), and the same for single quotes (`'…'`, `'…'`).
 * Strips only short spans (<= 80 chars between the quote marks) so prose
 * paragraphs with stray quotation marks don't disappear wholesale. Falls back
 * to leaving the text alone if no matching close is found on the same line —
 * quoted speech doesn't span paragraphs and a runaway match would erase real
 * content.
 *
 * Combine with `stripCodeFences` for full noise filtering. Order doesn't matter
 * (the two strip disjoint surfaces).
 */
export function stripQuotedSpans(text: string): string {
  // ASCII double quotes: "…" — up to 80 chars, single line.
  // ASCII single quotes: '…' — same constraint. Word-boundary
  // gate on the opening quote so we don't strip apostrophes
  // mid-word (e.g. "don't", "Claude's"). The closing quote can
  // be followed by anything.
  // Smart quotes get their own pass — Unicode codepoints don't fit
  // the ASCII charset and benefit from a separate, simpler regex.
  return text
    .replace(/"[^"\n]{1,80}"/g, ' ')
    .replace(/(^|[\s([{,;:>])'[^'\n]{1,80}'/g, '$1 ')
    .replace(/“[^”\n]{1,80}”/g, ' ')
    .replace(/‘[^’\n]{1,80}’/g, ' ')
}
