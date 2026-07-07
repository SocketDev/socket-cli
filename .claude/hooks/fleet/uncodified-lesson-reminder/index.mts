#!/usr/bin/env node
// Claude Code Stop hook — uncodified-lesson-reminder.
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
// so it does NOT overlap compound-lessons-reminder (which fires on a REPEAT
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

import { readLastAssistantToolUses, readStdin } from '../_shared/transcript.mts'

interface StopPayload {
  readonly transcript_path?: string | undefined
}

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
  const typeMatch = /^\s*type:\s*(feedback|project)\b/m.exec(content)
  if (!typeMatch) {
    return false
  }
  // An imperative/invariant shape worth enforcing.
  return /\b(always|never|must|don'?t|do not|forbid|require[ds]?|ban(?:ned)?)\b/i.test(
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

async function main(): Promise<void> {
  const raw = await readStdin()
  let payload: StopPayload
  try {
    payload = JSON.parse(raw) as StopPayload
  } catch {
    process.exit(0)
  }
  const toolUses = readLastAssistantToolUses(payload.transcript_path)
  const flagged: string[] = []
  for (let i = 0, { length } = toolUses; i < length; i += 1) {
    const evt = toolUses[i]!
    if (
      evt.name !== 'Write' &&
      evt.name !== 'Edit' &&
      evt.name !== 'MultiEdit'
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
    }
  }
  if (flagged.length === 0) {
    process.exit(0)
  }
  process.stderr.write(
    [
      '[uncodified-lesson-reminder] Recorded a durable lesson with no code enforcer:',
      '',
      ...flagged.map(f => `  • ${f}`),
      '',
      '  Memory alone does not enforce ("code is law"). Turn this into an',
      '  executable enforcer — run `/codifying-disciplines` (scans memory →',
      '  proposes a hook / lint rule / check + agents.md doc), or for a single',
      '  rule `node scripts/fleet/codify-rule.mts --memory <path> --apply`.',
    ].join('\n') + '\n',
  )
  process.exit(0)
}

// Entrypoint-guarded so importing this module (e.g. the unit test importing the
// pure helpers) does NOT run main() — which would block reading stdin.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    await main()
  })()
}
