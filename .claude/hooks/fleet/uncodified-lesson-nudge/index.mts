#!/usr/bin/env node
// Claude Code Stop hook — uncodified-lesson-nudge.
//
// The missing connector between "lesson recorded in memory" and "lesson
// codified into enforcing code." When this turn WROTE a durable memory lesson
// (a `feedback`/`project` entry with an enforceable "always/never/MUST" shape)
// but the memory carries NO enforcer citation (no `socket/<rule>`, no
// `.claude/hooks/`, no `scripts/fleet/check/`), nudge: "memory alone doesn't
// enforce — run /codifying-disciplines (or scripts/fleet/codify-rule.mts) to
// turn it into a hook / lint rule / check + agents.md doc."
//
// Non-blocking, exit 0, fail-open. Scoped strictly to the memory-write signal
// so it does NOT overlap compound-lessons-nudge (which fires on a REPEAT
// finding made without rule-promotion) — one surface per concern.
//
// Detection (the turn's own tool calls, never memory CONTENT beyond the write):
//   - a Write/Edit/MultiEdit to a path under a memory store
//     (`…/.claude/projects/<slug>/memory/*.md`), whose written content has
//     `type: feedback|project` in frontmatter AND an enforceable phrasing AND
//     no enforcer citation.
//
// Fail-open on parse / payload errors.

import process from 'node:process'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  recordOccurrence,
  RECURRENCE_THRESHOLD,
} from '../_shared/learning-ledger.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { readLastAssistantToolUses } from '../_shared/transcript.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// Memory-store path shape, separator-normalized: …/.claude/projects/<slug>/memory/<file>.md
const MEMORY_PATH_RE = /\/\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$/

export function isMemoryPath(filePath: string): boolean {
  return MEMORY_PATH_RE.test(filePath.replaceAll('\\', '/'))
}

// An enforceable lesson: a feedback/project memory whose body states an
// always/never/MUST-shaped rule or a build/release step. Reference/user memories
// (pointers, who-the-user-is) are NOT codification candidates.
export function isEnforceableLesson(content: string): boolean {
  // frontmatter `type:` (possibly nested under metadata:) is feedback|project.
  const typeMatch = /^\s*type:\s*(?:feedback|project)\b/m.exec(content)
  if (!typeMatch) {
    return false
  }
  // An imperative/invariant shape worth enforcing.
  return /\b(?:always|ban(?:ned)?|do not|don'?t|forbid|must|never|require[ds]?)\b/i.test(
    content,
  )
}

// True when the memory already cites a code enforcer — then it's codified, no
// nudge. Matches a hook dir, a socket/<rule>, or a check script path.
export function citesEnforcer(content: string): boolean {
  return (
    content.includes('.claude/hooks/') ||
    /\bsocket\/[a-z][a-z-]*/.test(content) ||
    content.includes('scripts/fleet/check/')
  )
}

export const check = (payload: ToolCallPayload): GuardResult => {
  const toolUses = readLastAssistantToolUses(payload?.transcript_path)
  const flagged: string[] = []
  // Content of each flagged lesson, for cross-session recurrence recording.
  const flaggedContent: string[] = []
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    const evt = toolUses[i]!
    if (
      evt.name !== 'Edit' &&
      evt.name !== 'MultiEdit' &&
      evt.name !== 'Write'
    ) {
      continue
    }
    const filePath =
      typeof evt.input['file_path'] === 'string' ? evt.input['file_path'] : ''
    if (!filePath || !isMemoryPath(filePath)) {
      continue
    }
    // The written text: Write `content`, Edit `new_string`. (MultiEdit edits are
    // an array; fall back to the stringified input so the shape scan still sees
    // the lesson text.)
    const content =
      typeof evt.input['content'] === 'string'
        ? evt.input['content']
        : typeof evt.input['new_string'] === 'string'
          ? evt.input['new_string']
          : JSON.stringify(evt.input)
    if (isEnforceableLesson(content) && !citesEnforcer(content)) {
      flagged.push(filePath.replace(/^.*\/memory\//, 'memory/'))
      flaggedContent.push(content)
    }
  }
  if (flagged.length === 0) {
    return undefined
  }
  // Record each still-uncodified lesson in the cross-session ledger. A lesson
  // re-written uncodified in a LATER session escalates: recording the same
  // memory content twice without an enforcer is the strongest "codify it now"
  // signal. Fail-open — a broken ledger yields 0 and the base nudge still fires.
  const projectDir = resolveProjectDir(
    process.env['CLAUDE_PROJECT_DIR'] ?? payload?.cwd,
  )
  const sessionId = payload?.transcript_path ?? 'unknown-session'
  let maxOccurrences = 0
  for (let i = 0, { length } = flaggedContent; i < length; i += 1) {
    const n = recordOccurrence(projectDir, {
      sessionId,
      text: `uncodified: ${flaggedContent[i]!}`,
      type: 'convention',
    })
    if (n > maxOccurrences) {
      maxOccurrences = n
    }
  }
  const lines = [
    '[uncodified-lesson-nudge] Recorded a durable lesson with no code enforcer:',
    '',
    ...flagged.map(f => `  • ${f}`),
    '',
  ]
  if (maxOccurrences >= RECURRENCE_THRESHOLD) {
    lines.push(
      `  ⚠ This lesson has been recorded uncodified across ${maxOccurrences} ` +
        'sessions (learning ledger) — stop deferring, codify it THIS turn.',
    )
    lines.push('')
  }
  lines.push(
    '  Memory alone does not enforce ("code is law"). Turn this into an',
    '  executable enforcer — run `/codifying-disciplines` (scans memory →',
    '  proposes a hook / lint rule / check + agents.md doc), or for a single',
    '  rule `node scripts/fleet/codify-rule.mts --memory <path> --apply`.',
  )
  return notify(lines.join('\n') + '\n')
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
