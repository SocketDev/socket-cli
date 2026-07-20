#!/usr/bin/env node
// Claude Code PreToolUse hook — no-subagent-commit-guard.
//
// BLOCKS (exit 2) a `git commit` / `git push` issued from a subagent turn. The
// fleet rule: a delegated work-product agent returns its work as a report and
// stops; the parent orchestrator reviews, re-runs the gates, and lands the
// change (docs/agents.md/fleet/agent-delegation.md). One reviewer sits between
// the work and `main`, and parallel agents never race each other on the tree.
//
// Detection: `mostRecentAssistantIsSidechain` — Claude Code marks a subagent
// (Task) turn `isSidechain:true` and the parent orchestrator's turns false. A
// commit whose most-recent assistant turn is a subagent is blocked; the parent's
// commit always passes (the parent IS the landing gate).
//
// Platform limit (honest scope): an inline Task subagent's turns are written
// into this transcript, so this guard catches them. A background / workflow
// subagent writes to its own transcript and its tool call reaches the hook with
// the PARENT's transcript (see unbacked-claim-commit-guard's note), so this
// guard cannot attribute a background child's commit and does not fire for it.
// Those are held by the agent-prompt discipline (every delegation forbids
// committing) plus the orchestrator gate. This guard is defense-in-depth for the
// case the platform lets us pin.
//
// The agents whose job IS a commit flow (the `fix` agent's surgical
// `git commit -o`, the history-rewrite skills) carry the bypass phrase so
// they keep working.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { mostRecentAssistantIsSidechain } from '../_shared/transcript.mts'

// Pre-flight: this guard can only block a command that invokes `git` (the
// commit/push subcommands matter only once `git` is present). The dispatcher
// skips importing the guard when `git` is absent from the payload.
export const triggers: readonly string[] = ['git']

// True when the command lands work — git commit or git push. Pull/fetch/status
// change nothing on the branch, so a subagent running them is harmless.
export function isLandingCommand(command: string): boolean {
  return (
    findInvocation(command, { binary: 'git', subcommand: 'commit' }) ||
    findInvocation(command, { binary: 'git', subcommand: 'push' })
  )
}

export const check = bashGuard((command, payload) => {
  if (!isLandingCommand(command)) {
    return undefined
  }
  const transcriptPath = payload.transcript_path
  if (!mostRecentAssistantIsSidechain(transcriptPath)) {
    // The parent orchestrator (or an unattributable background child) — allow.
    // The parent is the landing gate; a background child is held by prompt
    // discipline (see header).
    return undefined
  }
  return block(
    [
      '[no-subagent-commit-guard] Blocked: a subagent is committing.',
      '',
      '  A delegated agent returns its work as a report and stops; the parent',
      '  orchestrator reviews, re-runs the gates, and lands the change. This',
      '  keeps one reviewer between the work and the branch.',
      '',
      '  Return your changes and let the orchestrator commit them.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['subagent-commit'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
