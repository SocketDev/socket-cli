/*
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

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs'

/**
 * How many recent USER turns the bypass-phrase scans read by default. Small
 * enough that a phrase typed early in a long session can't silently authorize
 * a much-later action, large enough that interleaved tool-heavy turns don't
 * evict a freshly typed phrase. Hooks pass this shared constant to
 * `bypassPhrasePresent` so the fleet-wide lookback window is a single-edit
 * change instead of a per-hook magic number.
 */
export const BYPASS_LOOKBACK_USER_TURNS = 8

/**
 * Is any canonical bypass phrase present in a recent user turn? Substring
 * match on the separator-folded, case-folded form (see normalizeBypassText) —
 * `allow x bypass`, `Allow X bypass`, and `ALLOW X-BYPASS` all count.
 *
 * Accepts a string or string[] so callers with a single canonical spelling and
 * callers with distinct wordings share the same helper. The transcript is read
 * once; each phrase substring-checks against the same text.
 *
 * Use this when the bypass is **broad** — one phrase authorizes any matching
 * action for the rest of the conversation window. For **per-trigger**
 * authorization (one phrase = one action), use `bypassPhraseRemaining` instead
 * so a single phrase doesn't open the door for a follow-up action of the same
 * shape later.
 */
/**
 * Normalize a bypass phrase / haystack so hyphens and whitespace are removed
 * entirely. `Allow workflow-scope bypass`, `Allow workflow scope bypass`, and
 * `Allow workflowscope bypass` all collapse to the same canonical form for
 * matching — likewise `Opt-in` / `Opt in` / `Optin` and `non-fleet` /
 * `non fleet` / `nonfleet`. The transcript-reading helpers run user text
 * through this so separator variations don't break the phrase match: only the
 * letters + their order are load-bearing.
 */
export function normalizeBypassText(text: string): string {
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
  // Combined with the dash/whitespace fold below (and the optional-space
  // matching in phrasePattern), only the letters + their order are
  // load-bearing.
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[-—–\s]+/g, ' ')
    .toLowerCase()
}

/**
 * Compile a normalized phrase into a matcher where every inter-word gap is
 * OPTIONAL. `opt in readme fleet shape` then matches `Opt-in`, `Opt in`, and
 * `Optin` spellings alike (normalizeBypassText already folds dashes/whitespace
 * to one space; this makes that one space elidable), and `non fleet` matches
 * `nonfleet`. Regex metacharacters in the phrase (`:` targets, dots) are
 * escaped literally.
 */
export function phrasePattern(normalizedPhrase: string): RegExp {
  // Collapse whitespace on BOTH sides of a `:` target separator to a bare colon
  // first, so the emitted pattern makes surrounding space optional on either
  // side — `Allow x bypass: t`, `bypass :t`, `bypass  :  t`, and `bypass:t` all
  // match (normalizeBypassText already folded newlines + runs of space to one
  // space before this). Plain colon-free phrases are unaffected.
  const collapsed = normalizedPhrase.replace(/ *: */g, ':')
  const escaped = collapsed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const src = escaped.replace(/ /g, ' ?').replace(/:/g, ' ?: ?')
  return new RegExp(src, 'g')
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
  // A bypass authorization must be DELIBERATE user prose — not a phrase the user
  // (or an injected summary) merely quoted, code-spanned, or described. Strip
  // code fences/inline-code and quoted spans before matching (system-reminder
  // spans are already dropped in extractTurnPieces). Without this, a guard
  // self-disarms whenever its phrase appears as `Allow X bypass` in a code span,
  // a quote, a doc list, or a recap — which it did (no-direct-linter-guard).
  const text = stripQuotedSpans(
    stripCodeFences(readUserText(transcriptPath, lookbackUserTurns)),
  )
  if (!text) {
    return false
  }
  const haystack = normalizeBypassText(text)
  for (let i = 0; i < length; i += 1) {
    const needle = normalizeBypassText(list[i]!)
    if (phrasePattern(needle).test(haystack)) {
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
  // Same use-vs-mention filter as bypassPhrasePresent: a quoted, code-spanned,
  // or summarized occurrence is not a fresh authorization slot.
  const rawText = stripQuotedSpans(
    stripCodeFences(readUserText(transcriptPath, lookbackUserTurns)),
  )
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
    // Optional-space matching (see phrasePattern): `Opt-in` / `Opt in` /
    // `Optin` spellings occupy different span widths, so iterate real regex
    // matches rather than fixed-length indexOf hops.
    const pattern = phrasePattern(sorted[i]!)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (end === start) {
        // A degenerate all-separator phrase matches empty — step past it so
        // the exec loop can't spin in place.
        pattern.lastIndex = start + 1
        continue
      }
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
      pattern.lastIndex = end
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
 * Used by hooks (error-message-quality-nudge) that need to inspect the code
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
  const re = /```(?<lang>[a-zA-Z0-9_+-]*)\n?(?<body>[\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const body = match.groups?.['body']
    if (body !== undefined) {
      out.push({ lang: match.groups?.['lang'] ?? '', body })
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
 * Extract this turn's AUTHOR-WRITTEN text into a flat array of pieces. Handles
 * the 3 content shapes the harness emits (string / array-of-blocks / nested
 * message.content).
 *
 * SECURITY: `tool_result` and `tool_use` blocks are EXCLUDED. A `role: user`
 * message in the transcript carries two very different kinds of content —
 * genuine user typing (`{type:'text'}`) and tool results the harness injected
 * (`{type:'tool_result', content:…}`, e.g. the bytes of a file the agent read
 * or a command's stdout). Counting tool-result text as "user text" makes every
 * bypass-phrase check spoofable: a dependency file or command output containing
 * "Allow <X> bypass" would defeat the guard. So we only collect genuine `text`
 * blocks (and bare strings) and never a block's `content` field. Same reasoning
 * for assistant turns: `tool_use` inputs are not prose.
 */
// The harness-injected reminder element name. Built into tags at runtime so the
// literal closing tag never appears in this source (it reads as a fake
// system-tag to the prompt-injection scanner).
const REMINDER_TAG = 'system-reminder'

// Opening of the harness's context-compaction recap. The whole message is an
// injected summary of past work — "not the user" — so it's blanked wholesale.
const CONTINUATION_RECAP_PREFIX =
  'This session is being continued from a previous conversation'

/**
 * Strip harness-INJECTED content from a turn so only genuine author text
 * remains. Two injected shapes ride inside user-role turns and are explicitly
 * "not the user": (1) reminder spans the harness wraps around background
 * context (the CLAUDE.md block, recalled memories, task lists); (2) the
 * context- compaction recap that opens a continued session. Counting either as
 * author text makes every bypass-phrase check spoofable — a reminder, doc, or
 * recap that merely MENTIONS "Allow <X> bypass" silently disarms the guard (it
 * did: a no-direct-linter bypass matched CLAUDE.md / docs / the session recap,
 * never a user authorization). Same "never trust harness-injected content" rule
 * the tool_result/tool_use exclusion already applies.
 */
export function stripInjectedContext(text: string): string {
  // The compaction recap is a whole injected message — blank it entirely.
  if (text.trimStart().startsWith(CONTINUATION_RECAP_PREFIX)) {
    return ' '
  }
  const open = `<${REMINDER_TAG}>`
  const close = `</${REMINDER_TAG}>`
  // Closed spans first, then a trailing unclosed open-tag to EOF so a truncated
  // reminder can't leak its tail. Single literal tag name, no alternation.
  return text
    .replace(new RegExp(`${open}[\\s\\S]*?${close}`, 'g'), ' ')
    .replace(new RegExp(`${open}[\\s\\S]*$`), ' ')
}

export function extractTurnPieces(content: unknown): string[] {
  const pieces: string[] = []
  if (typeof content === 'string') {
    pieces.push(stripInjectedContext(content))
  } else if (Array.isArray(content)) {
    for (let i = 0, { length } = content; i < length; i += 1) {
      const block = content[i]!
      if (typeof block === 'string') {
        pieces.push(stripInjectedContext(block))
      } else if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        // Never trust harness-injected blocks as author text.
        if (b['type'] === 'tool_result' || b['type'] === 'tool_use') {
          continue
        }
        if (typeof b['text'] === 'string') {
          pieces.push(stripInjectedContext(b['text']))
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
  // Delegates to the turn-scoped reader: the documented contract was always
  // "the most-recent assistant TURN", but the old lookback=1 readRoleText
  // returned only the newest transcript ENTRY — a streamed reply spans many
  // entries, so mid-reply prose escaped every Stop scan built on this helper
  // (reply-prose-nudge's honesty verdict included).
  return readLastAssistantTurnText(transcriptPath)
}

// Entry cap for the turn-scoped reader below: bounds the backward scan so a
// megatranscript can't make every Stop event pay a full-file parse. A turn
// with 400+ trailing assistant/tool entries is far beyond any real reply.
const TURN_SCAN_CAP = 400

/**
 * Read the text of the entire most-recent assistant TURN — every trailing
 * assistant entry back to (but excluding) the last human message.
 *
 * A long streamed reply lands in the transcript as MULTIPLE assistant
 * entries (per content block / API response, interleaved with tool events),
 * so the lookback=1 entry read (`readLastAssistantText`) sees only the final
 * block. That let mid-message prose escape Stop-hook scans entirely: a
 * banned honesty-framing word in a reply's middle section sailed past
 * reply-prose for a whole session because the closing paragraph was clean.
 *
 * Turn boundary: a user entry whose content carries real text (a human
 * message). Tool-result user entries contribute no pieces — extractTurnPieces
 * skips tool_result blocks — so tool traffic inside the turn does not end it.
 * Sidechain scoping matches readLastAssistantTextSameActor: the newest
 * assistant entry fixes the scope, and entries of the other scope are
 * skipped, so a parent Stop never scans subagent prose (or vice versa).
 */
export function readLastAssistantTurnText(
  transcriptPath: string | undefined,
): string {
  const lines = readLines(transcriptPath)
  const out: string[] = []
  let scope: boolean | undefined
  const stop = Math.max(0, lines.length - TURN_SCAN_CAP)
  for (let i = lines.length - 1; i >= stop; i -= 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (!r) {
      continue
    }
    if (r.role === 'assistant') {
      if (scope === undefined) {
        scope = r.isSidechain
      } else if (r.isSidechain !== scope) {
        continue
      }
      const pieces = extractTurnPieces(r.content)
      if (pieces.length) {
        out.push(pieces.join('\n'))
      }
      continue
    }
    if (r.role === 'user' && extractTurnPieces(r.content).length > 0) {
      break
    }
  }
  return out.toReversed().join('\n')
}

/**
 * Like readLastAssistantText, but SCOPED to the sidechain status of the
 * most-recent assistant turn: returns the newest NON-EMPTY assistant turn whose
 * `isSidechain` matches the most-recent assistant turn, stopping at the first
 * turn of the OTHER scope. A subagent (Task) turn carries `isSidechain:true`,
 * the parent orchestrator's turns carry false. So a subagent's commit is gated
 * by the SUBAGENT's own recent claim and NEVER by the parent orchestrator's
 * prose (a different scope) — fixing the cross-actor false positive where an
 * orchestrator's unverified success claim blocked a subagent's commit. When the
 * most-recent assistant turn is the parent's, this reads the parent's turn and
 * the gate is unchanged.
 */
/**
 * True when the most-recent assistant turn is a subagent (Task/sidechain) turn.
 * Claude Code marks a subagent turn with `isSidechain:true` and the parent
 * orchestrator's turns with false. A hook gating on "did a subagent do this"
 * reads this: the newest assistant turn is the actor whose tool call is
 * running. Returns false when the transcript is missing or has no assistant
 * turn.
 *
 * Limit: this only sees turns written into THIS transcript. An inline Task
 * subagent's turns are inlined here (`isSidechain:true`); a background/workflow
 * subagent writes to its own transcript and never appears here, so a caller
 * cannot attribute a background child's tool call from this alone.
 */
export function mostRecentAssistantIsSidechain(
  transcriptPath: string | undefined,
): boolean {
  const lines = readLines(transcriptPath)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let evt: unknown
    try {
      evt = JSON.parse(lines[i]!)
    } catch {
      continue
    }
    const r = resolveRoleAndContent(evt)
    if (r?.role === 'assistant') {
      return r.isSidechain
    }
  }
  return false
}

export function readLastAssistantTextSameActor(
  transcriptPath: string | undefined,
): string {
  const lines = readLines(transcriptPath)
  let scope: boolean | undefined
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
    if (scope === undefined) {
      scope = r.isSidechain
    } else if (r.isSidechain !== scope) {
      // Crossed into the other actor's turns — stop before reading them.
      break
    }
    const pieces = extractTurnPieces(r.content)
    if (pieces.length) {
      return pieces.join('\n')
    }
  }
  return ''
}

/**
 * Walk the transcript newest → oldest, return every tool-use event from the
 * most recent assistant turn. Returns an empty array if the transcript is
 * missing or the most recent assistant turn has no tool uses. Used by hooks
 * that gate on what the assistant just did (e.g. file-size-nudge reading
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
 * compound-lessons-nudge detecting repeated edits to the same hook/skill
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
// Read at most this many bytes from the transcript TAIL. A long session grows
// past Node's max-string size (~536MB), where a whole-file readFileSync throws
// ERR_STRING_TOO_LONG and every phrase/turn scan silently sees an EMPTY
// transcript: bypass phrases stop working and guards fail closed. The signals
// these scans need (bypass phrases, recent turns) are recent by contract, so a
// bounded tail is both correct and far cheaper than slurping the whole file on
// every hook invocation.
const TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024

export function readLines(transcriptPath: string | undefined): string[] {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return []
  }
  let raw: string
  try {
    const { size } = statSync(transcriptPath)
    if (size > TRANSCRIPT_TAIL_BYTES) {
      const fd = openSync(transcriptPath, 'r')
      try {
        const buf = Buffer.alloc(TRANSCRIPT_TAIL_BYTES)
        const read = readSync(
          fd,
          buf,
          0,
          TRANSCRIPT_TAIL_BYTES,
          size - TRANSCRIPT_TAIL_BYTES,
        )
        raw = buf.subarray(0, read).toString('utf8')
      } finally {
        closeSync(fd)
      }
      // Drop the first (almost certainly partial) line of the tail window.
      const firstNewline = raw.indexOf('\n')
      raw = firstNewline === -1 ? '' : raw.slice(firstNewline + 1)
    } else {
      raw = readFileSync(transcriptPath, 'utf8')
    }
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
    if (!pieces.length) {
      // Tool-result carrier events share the user role but hold no author
      // prose. They must not consume lookback slots — a lookback of "8 user
      // turns" means 8 things the USER said, not 8 tool calls; otherwise a
      // busy turn evicts a freshly typed bypass phrase before the very
      // command it authorizes runs.
      continue
    }
    // Buffer this turn's blocks together so the final reverse swaps
    // *turn order*, not intra-turn block order.
    out.push(pieces.join('\n'))
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
// A per-event dispatcher reads stdin ONCE and re-exposes the raw payload via
// this env var, so many guards run in a single process without each racing for
// the already-consumed stdin fd. Not a kill switch — it carries the payload, it
// doesn't gate behavior.
const STDIN_ENV = 'CLAUDE_HOOK_STDIN'
let cachedStdin: string | undefined
export function readStdin(): Promise<string> {
  const injected = process.env[STDIN_ENV]
  if (typeof injected === 'string') {
    return Promise.resolve(injected)
  }
  if (cachedStdin !== undefined) {
    return Promise.resolve(cachedStdin)
  }
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buf += chunk
    })
    process.stdin.on('end', () => {
      cachedStdin = buf
      resolve(buf)
    })
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
      isSidechain: boolean
      role: string | undefined
    }
  | undefined {
  if (!evt || typeof evt !== 'object') {
    return undefined
  }
  const e = evt as Record<string, unknown>
  // A message the user types WHILE the assistant is working is recorded as a
  // queued-input event, not a `role:'user'` turn:
  // `{type:'queue-operation', operation:'enqueue', content:'<what they typed>'}`.
  // It IS genuine user prose — the user typed it, the harness only deferred
  // delivery — so a bypass phrase queued mid-work must count exactly like one
  // typed at an idle prompt. Without this, a user can authorize repeatedly and
  // be silently ignored (a lease-force-push phrase typed 4× mid-task never
  // registered). Not injectable: only a human enqueues input, and
  // extractTurnPieces still runs stripInjectedContext over the string, so a
  // reminder/tool span can't ride in. Non-`enqueue` queue ops carry no author
  // prose → skipped.
  if (e['type'] === 'queue-operation') {
    if (e['operation'] !== 'enqueue' || typeof e['content'] !== 'string') {
      return undefined
    }
    return { content: e['content'], isSidechain: false, role: 'user' }
  }
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
  // Claude Code marks a subagent (Task/sidechain) turn with `isSidechain:true`;
  // the parent orchestrator's turns carry false/absent.
  return { content, isSidechain: e['isSidechain'] === true, role }
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
    .replace(/(?<boundary>^|[\s([{,;:>])'[^'\n]{1,80}'/g, '$<boundary> ')
    .replace(/“[^”\n]{1,80}”/g, ' ')
    .replace(/‘[^’\n]{1,80}’/g, ' ')
}
