#!/usr/bin/env node
// Claude Code PreToolUse hook — ask-suppression-nudge.
//
// Fires (with a stderr reminder, not a block) when the assistant invokes
// AskUserQuestion while the recent transcript carries an explicit go-ahead
// directive from the user. The hook DOES NOT block — it surfaces a one-line
// reminder so the assistant notices the dont-ask-proceed signal and picks
// the obvious default instead of asking.
//
// Reasoning behind reminder-only:
//   - Sometimes the question is genuinely scoping ("which of these N
//     options?" after the user said "yes, proceed"). Blocking would prevent
//     legitimate scoping.
//   - A noisy stderr nudge keeps the cost low; the assistant's response is
//     to skip the question, not to refuse.
//
// Detection model:
//   - Fires only on AskUserQuestion tool calls.
//   - Reads the most recent N user turns from the transcript.
//   - Looks for go-ahead directives: standalone "yes" / "do it" / "proceed"
//     / "go" / "continue" / digit-only ("1") / "all of them".
//   - Conservative: only flags when at least one directive appears AS the
//     most recent user turn's text content (not buried in a paragraph).

import { readFileSync } from 'node:fs'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Patterns that signal "you have go-ahead; don't ask again". Match against
// the full trimmed text of a user turn — must be the entire message body,
// not a substring (to avoid firing on "yes" mid-paragraph).
const GO_AHEAD_PATTERNS = [
  /^yes\.?$/i,
  /^y\.?$/i,
  /^do it\.?$/i,
  /^proceed\.?$/i,
  /^go\.?$/i,
  /^continue\.?$/i,
  /^continue\.?\s*$/i,
  /^[0-9]+\.?$/, // digit-only ("1", "2")
  /^all of them\.?$/i,
  /^all\.?$/i,
  /^ship (?:it|them)\.?$/i,
  /^k\.?$/i,
  /^ok\.?$/i,
  /^sure\.?$/i,
]

// How many recent user turns to scan. Larger windows catch stale directives;
// smaller windows lose context. 3 is a balance.
const RECENT_TURN_WINDOW = 3

export function matchesGoAhead(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) {
    return false
  }
  for (let i = 0, { length } = GO_AHEAD_PATTERNS; i < length; i += 1) {
    const re = GO_AHEAD_PATTERNS[i]!
    if (re.test(trimmed)) {
      return true
    }
  }
  return false
}

export function readRecentUserTurns(
  transcriptPath: string,
  window: number,
): string[] {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return []
  }
  const turns: string[] = []
  const lines = raw.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.trim()) {
      continue
    }
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry === null || typeof entry !== 'object') {
      continue
    }
    if ((entry as { type?: string | undefined }).type !== 'user') {
      continue
    }
    const msg = (
      entry as { message?: { content?: unknown | undefined } | undefined }
    ).message
    if (!msg) {
      continue
    }
    const c = msg.content
    if (typeof c === 'string') {
      turns.push(c)
    } else if (Array.isArray(c)) {
      // Newer format — content is an array of segments.
      const text = c
        .map(seg =>
          typeof seg === 'string'
            ? seg
            : typeof (seg as { text?: unknown | undefined }).text === 'string'
              ? (seg as { text: string }).text
              : '',
        )
        .join('\n')
      turns.push(text)
    }
  }
  return turns.slice(-window)
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'AskUserQuestion') {
    return undefined
  }

  if (!payload.transcript_path) {
    return undefined
  }

  const turns = readRecentUserTurns(payload.transcript_path, RECENT_TURN_WINDOW)
  if (turns.length === 0) {
    return undefined
  }

  // Find the most recent user turn that matches the go-ahead pattern.
  let matched: string | undefined
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (matchesGoAhead(turns[i]!)) {
      matched = turns[i]
      break
    }
  }
  if (!matched) {
    return undefined
  }

  // Reminder-only — notify (stderr, exit 0). Claude Code surfaces the
  // stderr text to the assistant without blocking the tool call.
  return notify(
    [
      '[ask-suppression-nudge] AskUserQuestion with recent go-ahead directive',
      '',
      `  Recent user turn: "${matched.trim().slice(0, 80)}"`,
      '',
      '  The user has given you explicit permission to proceed. Reconsider',
      '  whether the question is genuinely scoping (a real ambiguity you',
      '  cannot resolve from context) or whether you should pick the',
      '  obvious default and execute.',
      '',
      '  Per CLAUDE.md Judgment & self-evaluation: skip AskUserQuestion',
      '  when intent is clear; pick the obvious default and execute.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['AskUserQuestion'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
