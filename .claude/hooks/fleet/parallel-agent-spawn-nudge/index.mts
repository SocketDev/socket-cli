#!/usr/bin/env node
// Claude Code PreToolUse hook — parallel-agent-spawn-nudge.
//
// Fires (with a stderr reminder, not a block) when the orchestrator spawns an
// agent (the Task tool) whose prompt tells that agent to COMMIT / PUSH / LAND.
// Parallel agents committing into one shared checkout race the git index and
// the pre-commit hook (two `git add` + commit runs interleave, one clobbers the
// other's staged set, or both contend for .git/index.lock). The safe pattern:
//   - each agent works a DISJOINT file area,
//   - each agent EDITS + VERIFIES but leaves its work UNCOMMITTED,
//   - the orchestrator (this session) commits, by explicit path.
//
// Reminder-only (notify, exit 0): a single agent told to commit on its own
// throwaway worktree is legitimate, so blocking would be wrong. The nudge just
// surfaces the discipline at the moment of spawning.
//
// Detection: Task tool call whose `prompt` contains a commit/push/land signal.
// Matched with plain string `.includes` on the lowercased prompt — NOT a regex
// (no-hook-cmd-regex-guard: a regex carrying `git commit` reads as a shell-
// command parser). The signals are natural-language instructions, not commands.
//
// Detail: docs/agents.md/fleet/agent-delegation.md.

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

// Lowercased substrings that signal the spawned agent is being told to land its
// own work — the index-race anti-pattern when more than one agent shares the
// checkout. Kept as plain strings (see the no-regex note in the header).
const COMMIT_SIGNALS: readonly string[] = [
  'commit and push',
  'commit it',
  'commit the',
  'commit them',
  'commit your',
  'create a pr',
  'force-push',
  'force push',
  'git commit',
  'git push',
  'git rebase',
  'land it',
  'land the',
  'land your',
  'open a pr',
  'push to ',
  'push your',
]

export function promptInstructsCommit(prompt: string): string | undefined {
  const lower = prompt.toLowerCase()
  for (let i = 0, { length } = COMMIT_SIGNALS; i < length; i += 1) {
    const signal = COMMIT_SIGNALS[i]!
    if (lower.includes(signal)) {
      return signal
    }
  }
  return undefined
}

export const check = (payload: ToolCallPayload): GuardResult => {
  if (payload.tool_name !== 'Task') {
    return undefined
  }
  // `prompt` is the Task tool's instruction field — not in payload.mts's
  // narrowed ToolInput union, so read it via a local shape (never `any`).
  const input = payload.tool_input as
    | { prompt?: unknown | undefined }
    | undefined
  const prompt = typeof input?.prompt === 'string' ? input.prompt : ''
  if (!prompt) {
    return undefined
  }
  const signal = promptInstructsCommit(prompt)
  if (!signal) {
    return undefined
  }
  return notify(
    [
      '[parallel-agent-spawn-nudge] Spawning an agent told to commit/push.',
      '',
      `  The agent prompt says: "…${signal}…".`,
      '',
      '  Parallel agents committing into one checkout race the git index and',
      '  the pre-commit hook. Prefer the disjoint-area + orchestrator-commits',
      '  pattern:',
      '    - give each agent a DISJOINT file area (no overlap),',
      '    - have the agent EDIT + VERIFY but leave work UNCOMMITTED,',
      '    - YOU (this session) commit by explicit path (`git commit -o …`).',
      '',
      '  A single agent on its own throwaway worktree may commit safely —',
      '  this is a reminder, not a block. See agent-delegation.md.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Task'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
