#!/usr/bin/env node
// Claude Code PreToolUse hook — unbacked-claim-commit-guard.
//
// BLOCKS (exit 2) a `git commit` / `git push` when the LAST assistant turn made
// a success self-claim — "tests pass", "the build succeeds", "typechecks", "lint
// passes", "render verified" — that NO Bash command this session backs.
//
// The fleet rule (CLAUDE.md "Judgment & self-evaluation" → "Verify before you
// claim"): never assert a check passed without a tool call this session that ran
// it. The Stop-time `stop-claim-verify-nudge` nudges at turn-end; this is the
// hard half — it stops the unverified claim from LANDING in a commit/push.
//
// DRY: detection (findUnbackedClaims / sessionBashCommands / CLAIM_RULES) is the
// SAME `_shared/unbacked-claims.mts` matcher the Stop reminder uses. One matcher,
// two enforcement points — they never drift.
//
// Live background child (same root cause as dirty-worktree-stop-guard #206):
// Claude Code hands EVERY hook the PARENT session's `transcript_path`, even for
// a tool call a spawned background subagent issues (the subagent's own turns
// live only in `<session>/subagents/agent-<id>.jsonl`, never inlined into the
// parent's file). So when a subagent commits, `readLastAssistantTextSameActor`
// reads the PARENT's last assistant turn — attributing the PARENT's prose to the
// SUBAGENT's commit (or vice versa). That's a cross-actor false positive, not a
// correctly-scoped claim: when a background child is live, actor attribution
// from the transcript alone is ambiguous, so this guard fails OPEN rather than
// block on a claim it can't confidently pin on the committing actor. This is
// prose hygiene, not a security boundary — a missed unbacked claim is far
// cheaper than blocking a subagent's legitimate commit on the dispatcher's
// unrelated prose.
//
// Bypass: `Allow unbacked-claim bypass` in a recent user turn (for the case
// where the claim is true but verified outside this session, or is fine to land).

import {
  CHILD_LIVE_WINDOW_MS,
  hasLiveBackgroundChild,
} from '../_shared/active-edits-ledger.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { readLastAssistantTextSameActor } from '../_shared/transcript.mts'
import {
  findUnbackedClaims,
  sessionBashCommands,
} from '../_shared/unbacked-claims.mts'

// Pre-flight: this guard can ONLY block when the command invokes `git commit`
// or `git push` (see isLandingCommand → findInvocation, whose own substring
// gate requires the binary `git` verbatim). The subcommands `commit`/`push`
// are subsumed — they matter only once `git` is present — so the binary name
// is the complete, minimal trigger. The dispatcher skips importing this guard
// when `git` is absent from the payload.
export const triggers: readonly string[] = ['git']

// True when the command lands work — git commit or git push. Pull/fetch/status
// don't land anything, so an unverified claim sitting next to them is harmless.
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
  // A live background child means attribution is ambiguous — fail open
  // rather than risk blaming the wrong actor's prose (see header comment).
  if (
    hasLiveBackgroundChild(transcriptPath, {
      now: Date.now(),
      windowMs: CHILD_LIVE_WINDOW_MS,
    })
  ) {
    return undefined
  }
  // Scope to the committing actor: a subagent's commit is gated by the
  // subagent's own claims, never the parent orchestrator's (cross-actor false
  // positive). See readLastAssistantTextSameActor.
  const text = readLastAssistantTextSameActor(transcriptPath)
  if (!text) {
    return undefined
  }
  const unbacked = findUnbackedClaims(text, sessionBashCommands(transcriptPath))
  if (!unbacked.length) {
    return undefined
  }
  const lines = [
    '[unbacked-claim-commit-guard] Blocked: landing a commit/push with an',
    'unverified success claim in this turn:',
    '',
  ]
  for (let i = 0, { length } = unbacked; i < length; i += 1) {
    const u = unbacked[i]!
    lines.push(`  • "${u.label}" — ${u.hint}`)
  }
  lines.push('')
  lines.push('  Run the command that backs the claim (and let its output show)')
  lines.push('  before committing, or qualify the statement. Verify before you')
  lines.push('  claim — and before you land.')
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['unbacked-claim'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
