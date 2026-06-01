#!/usr/bin/env node
// Claude Code Stop hook — follow-direct-imperative-reminder.
//
// Fires at turn-end. If the immediately-preceding user turn was a bare
// imperative command (short, action-verb-led) AND the just-emitted
// assistant text contains hedge / re-litigation patterns BEFORE any
// tool call, emit a stderr reminder pointing at the failure mode.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation"):
//
//   Direct imperatives → execute, don't litigate. When the user
//   issues a bare command ("use nvm 26.2.0", "cancel the build",
//   "do it", "kill it"), the response is the tool call, not a
//   paragraph weighing trade-offs.
//
// Past incident: user typed "use nvm use 26.2.0"; assistant responded
// with a paragraph explaining why it wouldn't help the in-flight
// build instead of running the command. Same turn the user typed
// "cancel the build right now" — assistant continued narrating
// build phases instead of killing the process. The user explicitly
// asked for a hook to stop this.
//
// Detection:
//   - Last user turn is a single short imperative (≤ 8 words,
//     starts with an action verb or a known imperative form).
//   - Last assistant turn (just emitted) contains hedge openers
//     OR a leading analysis paragraph that precedes any tool call.
//
// Why a reminder, not a block: Stop hooks fire AFTER the turn ended.
// The reminder lands in the next turn's context so the agent sees
// the pattern it just exhibited.
//
// Exit codes:
//   0 — always. Informational; never blocks.
//
// Disabled via `SOCKET_FOLLOW_DIRECT_IMPERATIVE_REMINDER_DISABLED=1`.

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { isHookDisabled } from '../_shared/hook-env.mts'
import { readStdin } from '../_shared/transcript.mts'

interface TranscriptEntry {
  readonly type?: string | undefined
  readonly role?: string | undefined
  readonly message?:
    | {
        readonly content?: unknown | undefined
        readonly role?: string | undefined
      }
    | undefined
  readonly content?: unknown | undefined
}

export async function readStopPayload(): Promise<{
  transcript_path?: string | undefined
}> {
  const raw = await readStdin()
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as { transcript_path?: string | undefined }
  } catch {
    return {}
  }
}

// Read the last N entries from a JSONL transcript file. The harness
// uses one JSON object per line.
export function readTranscriptTail(
  path: string,
  count: number,
): TranscriptEntry[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n').filter(Boolean)
  const tail = lines.slice(-count)
  const out: TranscriptEntry[] = []
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as TranscriptEntry)
    } catch {
      // ignore malformed
    }
  }
  return out
}

// Flatten content (string | content-block-array) into one string.
export function flattenContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object') {
        const b = block as {
          type?: string | undefined
          text?: string | undefined
        }
        if (b.type === 'text' && typeof b.text === 'string') {
          parts.push(b.text)
        }
      }
    }
    return parts.join('\n')
  }
  return ''
}

// Role detection across the two shapes the transcript uses.
export function entryRole(e: TranscriptEntry): string | undefined {
  return e.role ?? e.message?.role ?? e.type
}

export function entryText(e: TranscriptEntry): string {
  return flattenContent(e.message?.content ?? e.content ?? '')
}

// Imperative-command opening verbs/forms. Kept conservative —
// over-matching would trigger the reminder on normal conversation.
const IMPERATIVE_OPENERS = [
  // Single-verb commands.
  'cancel',
  'kill',
  'stop',
  'abort',
  'do',
  'use',
  'run',
  'commit',
  'push',
  'fix',
  'try',
  'continue',
  'restart',
  'rerun',
  'redo',
  'execute',
  'go',
  'land',
  'merge',
  'rebase',
  'reset',
  'add',
  'remove',
  'delete',
  'install',
  'switch',
  'check',
  'show',
  'list',
  'open',
  'close',
  'undo',
  'revert',
  'apply',
  'build',
  'test',
  'deploy',
  'finish',
  'follow',
  'now',
  // Common imperative phrases.
  "let's",
  'just',
  'please',
]

// Returns true when the text looks like a bare imperative directive
// (short, action-verb-led, no question mark, no long context).
export function looksLikeImperative(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) {
    return false
  }
  // Strip leading punctuation.
  const body = trimmed.replace(/^[!,.\s]+/, '')
  // Skip questions entirely — questions invite analysis.
  if (body.includes('?')) {
    return false
  }
  // Bounded length: long contextual messages are not bare imperatives.
  const wordCount = body.split(/\s+/).filter(Boolean).length
  if (wordCount > 8) {
    return false
  }
  // Pull the first word.
  const firstWord = body.split(/\s+/)[0] ?? ''
  return IMPERATIVE_OPENERS.includes(firstWord)
}

// Hedge / re-litigation markers in the assistant's text. The goal is
// to catch paragraphs that explain WHY the command might not help
// before the tool call lands.
const HEDGE_MARKERS = [
  /\bdoesn't help\b/i,
  /\bwon't help\b/i,
  /\bbefore (?:i|we) (?:do that|run|kick|switch|cancel)\b/i,
  /\blet me (?:explain|first|note)\b/i,
  /\b(?:to be clear|just so we'?re clear)\b/i,
  /\bworth (?:checking|confirming|noting)\b/i,
  /\bone thing to (?:note|flag)\b/i,
  /\bthat said\b/i,
  /\bactually,?\s+/i,
  /\b(?:however|but),?\s+(?:that|the|this)\b/i,
  // "the in-flight X is past Y" — re-litigation of in-flight state.
  /\bthe in-?flight\b/i,
  // Heavy throat-clearing.
  /\b(?:caveat|note|important):/i,
]

export function hasHedge(text: string): boolean {
  for (let i = 0, { length } = HEDGE_MARKERS; i < length; i += 1) {
    const re = HEDGE_MARKERS[i]!
    if (re.test(text)) {
      return true
    }
  }
  return false
}

async function main(): Promise<void> {
  if (isHookDisabled('follow-direct-imperative-reminder')) {
    return
  }
  const payload = await readStopPayload()
  const transcriptPath = payload.transcript_path
  if (!transcriptPath) {
    return
  }
  // Pull the last ~6 entries — usually covers the last user + last
  // assistant turn plus any tool result entries between them.
  const tail = readTranscriptTail(transcriptPath, 8)
  if (tail.length === 0) {
    return
  }

  // Find the last assistant entry (what we just emitted) and the
  // last user entry BEFORE it.
  let lastAssistantIdx = -1
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    if (entryRole(tail[i]!) === 'assistant') {
      lastAssistantIdx = i
      break
    }
  }
  if (lastAssistantIdx === -1) {
    return
  }
  let lastUserIdx = -1
  for (let i = lastAssistantIdx - 1; i >= 0; i -= 1) {
    if (entryRole(tail[i]!) === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) {
    return
  }

  const userText = entryText(tail[lastUserIdx]!)
  const assistantText = entryText(tail[lastAssistantIdx]!)
  if (!userText || !assistantText) {
    return
  }
  if (!looksLikeImperative(userText)) {
    return
  }
  if (!hasHedge(assistantText)) {
    return
  }

  const userPreview = userText.trim().slice(0, 60)
  process.stderr.write(
    [
      '[follow-direct-imperative-reminder] You hedged before executing a direct imperative.',
      '',
      `  User said: "${userPreview}"`,
      '',
      '  The response to a bare command should be the tool call,',
      '  not a paragraph weighing trade-offs. Hedge openers ("That',
      '  won\'t help…", "Let me explain…", "Before I do that…") +',
      '  analysis-before-action when the command was unambiguous',
      '  are the failure mode the rule targets.',
      '',
      '  Fix: state the intent in one short sentence at most, then',
      '  run the command. If you genuinely think the directive is',
      "  wrong, run it AFTER raising the concern — don't refuse to act.",
      '',
      "  CLAUDE.md → 'Judgment & self-evaluation' → Direct imperatives.",
      '',
    ].join('\n'),
  )
}

main().catch(e => {
  process.stderr.write(
    `[follow-direct-imperative-reminder] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
})
