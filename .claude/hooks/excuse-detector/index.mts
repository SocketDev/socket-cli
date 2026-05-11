#!/usr/bin/env node
// Claude Code Stop hook — excuse-detector.
//
// Scans the assistant's most recent turn in the conversation
// transcript for excuse-shaped phrases that violate CLAUDE.md's
// "No 'pre-existing' excuse" rule. On match, emits a stderr
// warning naming the phrase and the rule so the user can call it
// out before the next turn.
//
// The hook does NOT block. Stop hooks fire when the assistant
// has already produced a response; blocking would just truncate
// the message. The warning surfaces *after* the assistant's
// output so the user reads both and can demand a fix.
//
// What it catches:
//
//   - "pre-existing" / "preexisting"        — the bare rationalization
//   - "not related to my <X>"               — scoping out a fix
//   - "unrelated to the task"               — same
//   - "out of scope"                        — same
//   - "this is a separate concern"          — same
//   - "I'll leave it for later"             — deferral marker
//   - "not my issue"                        — scoping out
//
// Each phrase carries a "why" so the user can see the specific
// CLAUDE.md rule that's being skipped.
//
// Reads a Claude Code Stop JSON payload from stdin:
//   { "transcript_path": "/.../session.jsonl", ... }
//
// Exit codes:
//   0 — always (informational only).
//
// Disabled via SOCKET_EXCUSE_DETECTOR_DISABLED env var.

import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

interface ExcusePattern {
  readonly label: string
  readonly regex: RegExp
  readonly why: string
}

const EXCUSE_PATTERNS: readonly ExcusePattern[] = [
  {
    label: 'pre-existing',
    regex: /\bpre[- ]?existing\b/i,
    why: 'CLAUDE.md "No pre-existing excuse": if you see a lint error, type error, test failure, broken comment, or stale comment anywhere in your reading window — fix it.',
  },
  {
    label: 'not related to my',
    regex: /\b(not |un)?related to my\b/i,
    why: 'CLAUDE.md "Unrelated issues are critical": an unrelated bug is not a reason to defer — it is a reason to treat it as critical and fix it immediately.',
  },
  {
    label: 'unrelated to the task',
    regex: /\bunrelated to (the |this )?task\b/i,
    why: 'CLAUDE.md "Unrelated issues are critical": same as above.',
  },
  {
    label: 'out of scope',
    regex: /\b(out of|outside)( (the|this))? scope\b/i,
    why: 'CLAUDE.md "No pre-existing excuse": the only exceptions are genuinely large refactors (state the trade-off and ask) or files belonging to another session.',
  },
  {
    label: 'separate concern',
    regex: /\bseparate concern\b/i,
    why: 'CLAUDE.md "Unrelated issues are critical": fix the unrelated bug first, in its own commit, then resume the original task.',
  },
  {
    label: 'leave it for later',
    regex: /\bleave (it|that|this) for later\b/i,
    why: 'CLAUDE.md "Completion": never leave TODO/FIXME/XXX/shims/stubs/placeholders — finish 100%.',
  },
  {
    label: 'not my issue',
    regex: /\bnot my (issue|problem|bug)\b/i,
    why: 'CLAUDE.md "Unrelated issues are critical": same as "unrelated".',
  },
]

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  if (process.env['SOCKET_EXCUSE_DETECTOR_DISABLED']) {
    process.exit(0)
  }
  let payload: StopPayload
  try {
    payload = JSON.parse(payloadRaw) as StopPayload
  } catch {
    process.exit(0)
  }

  const transcriptPath = payload.transcript_path
  if (!transcriptPath || !existsSync(transcriptPath)) {
    process.exit(0)
  }
  const text = readLastAssistantTurn(transcriptPath)
  if (!text) {
    process.exit(0)
  }

  const hits: Array<{ label: string; why: string; snippet: string }> = []
  for (const pattern of EXCUSE_PATTERNS) {
    const match = pattern.regex.exec(text)
    if (!match) {
      continue
    }
    hits.push({
      label: pattern.label,
      why: pattern.why,
      snippet: extractSnippet(text, match.index, match[0].length),
    })
  }

  if (hits.length === 0) {
    process.exit(0)
  }

  process.stderr.write(
    [
      '[excuse-detector] Assistant turn contains rationalization phrases:',
      '',
      ...hits.flatMap(h => [
        `  • "${h.label}" — ${h.snippet}`,
        `      ${h.why}`,
      ]),
      '',
      '  These phrases usually precede a deferral. Read the surrounding',
      '  text and decide: is the fix actually out of scope (rare), or',
      '  is the assistant rationalizing avoiding work? If the latter,',
      '  push back and demand the fix in the next turn.',
      '',
    ].join('\n'),
  )
  process.exit(0)
})

/**
 * Walk the transcript backward, return the text content of the most
 * recent assistant turn. Empty string when not found.
 */
function readLastAssistantTurn(transcriptPath: string): string {
  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return ''
  }
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]
    if (!line) {
      continue
    }
    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      continue
    }
    if (!evt || typeof evt !== 'object') {
      continue
    }
    const e = evt as Record<string, unknown>
    const role =
      typeof e['role'] === 'string'
        ? e['role']
        : typeof e['type'] === 'string'
          ? e['type']
          : undefined
    if (role !== 'assistant') {
      continue
    }
    const message = e['message']
    const content: unknown =
      e['content'] ??
      (message && typeof message === 'object'
        ? (message as Record<string, unknown>)['content']
        : undefined)
    return extractTextContent(content)
  }
  return ''
}

/**
 * Normalize the content field into a single text string. Supports
 * the three shapes the harness emits: plain string, array of blocks,
 * object with `text`.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (typeof block === 'string') {
        parts.push(block)
        continue
      }
      if (block && typeof block === 'object') {
        const b = block as Record<string, unknown>
        if (b['type'] === 'text' && typeof b['text'] === 'string') {
          parts.push(b['text'])
        }
      }
    }
    return parts.join('\n')
  }
  if (content && typeof content === 'object') {
    const text = (content as Record<string, unknown>)['text']
    if (typeof text === 'string') {
      return text
    }
  }
  return ''
}

/**
 * Pull a ~80-char snippet around the match for the warning message.
 */
function extractSnippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}
