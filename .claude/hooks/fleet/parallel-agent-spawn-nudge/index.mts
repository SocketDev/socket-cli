#!/usr/bin/env node
// Claude Code PreToolUse hook — parallel-agent-spawn-nudge.
//
// Fires (with a stderr reminder, not a block) when the orchestrator spawns an
// agent (the `Task` OR `Agent` tool) whose prompt tells that agent to COMMIT /
// PUSH / LAND. Parallel agents committing into one shared checkout race the git
// index and the pre-commit hook (two `git add` + commit runs interleave, one
// clobbers the other's staged set, or both contend for .git/index.lock). The
// full parallel-write discipline the nudge surfaces:
//   - the ORCHESTRATOR owns every SHARED / cross-cutting file (a shared test
//     runner, a config, a manifest) — edit it yourself, once, BEFORE fanning
//     out; never delegate a shared file to one agent, which serializes the rest
//     and races the others,
//   - give each agent a DISJOINT file area (one lang dir, one module) — no
//     overlap with a sibling or with the shared files you own,
//   - each agent EDITS + VERIFIES but leaves its work UNCOMMITTED,
//   - the orchestrator (this session) reviews, re-runs the gates, and lands it
//     by explicit path (`git commit -o …`) — one reviewer between work and main.
//
// Reminder-only (notify, exit 0): a single agent told to commit on its own
// throwaway worktree is legitimate, so blocking would be wrong. The nudge just
// surfaces the discipline at the moment of spawning.
//
// Detection: a `Task`/`Agent` tool call whose `prompt` contains a
// commit/push/land signal. Matched with plain string `.includes` on the
// lowercased prompt — NOT a regex (no-hook-cmd-regex-guard: a regex carrying
// `git commit` reads as a shell-command parser). The signals are
// natural-language instructions, not commands.
//
// Honest scope: matching both `Task` and `Agent` catches inline + background
// Agent-tool spawns; a Workflow `agent()` spawn bypasses PreToolUse entirely
// (platform limit) and is held only by the inlined agent-prompt discipline. And
// the "delegate a shared file" half is taught in the message + agent-delegation
// doc, not auto-detected — a generic hook can't know which paths a repo treats
// as shared.
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
  // Both spawn-tool names: Claude Code's classic `Task` and this harness's
  // `Agent`. Sibling hooks match both (adversarial-review-nudge,
  // variant-analysis-nudge); matching only `Task` silently skipped every
  // `Agent`-tool spawn — which is how a "commit surgically" delegation slipped
  // through unnudged.
  if (payload.tool_name !== 'Agent' && payload.tool_name !== 'Task') {
    return undefined
  }
  // `prompt` is the spawn tool's instruction field — not in payload.mts's
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
      '  the pre-commit hook. Use the full parallel-write discipline:',
      '    - YOU own every SHARED / cross-cutting file (a shared test runner,',
      '      a config, a manifest) — edit it yourself ONCE before fanning out;',
      "      don't hand a shared file to an agent (it serializes the rest),",
      '    - give each agent a DISJOINT file area (one lang dir / module),',
      '    - have the agent EDIT + VERIFY but leave work UNCOMMITTED and report',
      '      its touched-file list,',
      '    - YOU review, re-run the gates, and land by explicit path',
      '      (`git commit -o …`) — one reviewer between the work and main.',
      '',
      '  A single agent on its own throwaway worktree may commit safely —',
      '  this is a reminder, not a block. See agent-delegation.md.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Task', 'Agent'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
