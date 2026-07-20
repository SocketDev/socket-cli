#!/usr/bin/env node
// Claude Code PreToolUse hook — no-pr-review-verdict-guard.
//
// Blocks a `gh pr review` that delivers a VERDICT — `--approve` / `-a` or
// `--request-changes` / `-r`. Approving or requesting changes is a human's
// call; the agent reviews by leaving findings and flags the PR for the user.
//
// `gh pr review --comment` / `-c` (a comment-only review) and `gh pr comment`
// pass untouched — the agent may comment, never render a verdict. The guard is
// deliberately narrow: it fires ONLY on a `gh pr review` invocation carrying an
// approve/request-changes flag, parsed with the fleet shell tokenizer so a
// quoted flag in a body or a sibling command can't false-fire.
//
// Bypass: `Allow pr-review-verdict bypass` in a recent user turn (rare — a
// verdict should come from a person, not the agent).

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Verdict flags on `gh pr review`. `--comment`/`-c` (comment-only) is allowed
// and deliberately absent here. Sorted ASCII.
const VERDICT_FLAGS: readonly string[] = [
  '--approve',
  '--request-changes',
  '-a',
  '-r',
]

// Pre-flight gate: the dispatcher only imports this guard when the raw payload
// contains `pr review`.
export const triggers: readonly string[] = ['pr review']

function isVerdictFlag(arg: string): boolean {
  return (
    VERDICT_FLAGS.includes(arg) ||
    arg.startsWith('--approve') ||
    arg.startsWith('--request-changes')
  )
}

// The approve/request-changes flag on a `gh pr review` invocation, or undefined
// when none. Tokenizes with the fleet parser (commandsFor) so the flag only
// counts when it rides `gh pr review`'s own args.
export function reviewVerdictFlagIn(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'gh')) {
    if (cmd.args[0] !== 'pr' || cmd.args[1] !== 'review') {
      continue
    }
    const flag = cmd.args.find(isVerdictFlag)
    if (flag) {
      return flag
    }
  }
  return undefined
}

// Decide what (if anything) to block for a payload. Returns the offending flag,
// or undefined to pass. Pure — the test drives it directly.
export function reviewVerdictViolation(
  payload: ToolCallPayload,
): string | undefined {
  if (payload.tool_name !== 'Bash') {
    return undefined
  }
  const command = payload.tool_input?.command
  if (typeof command !== 'string') {
    return undefined
  }
  return reviewVerdictFlagIn(command)
}

export function check(payload: ToolCallPayload): GuardResult {
  const flag = reviewVerdictViolation(payload)
  if (!flag) {
    return undefined
  }
  return block(
    [
      '[no-pr-review-verdict-guard] Blocked: a PR review verdict.',
      '',
      `  What:  \`gh pr review\` was given \`${flag}\` — an approve or`,
      '         request-changes verdict.',
      '  Where: that makes the agent the approver/blocker. A verdict',
      '         (approve or request changes) is a human decision.',
      '',
      '  Fix:   leave findings with `gh pr comment` or `gh pr review',
      '         --comment`, then flag the PR for a person to give the',
      '         verdict. The agent reviews; it never approves or rejects.',
    ].join('\n'),
  )
}

export const hook = defineHook({
  bypass: ['pr-review-verdict'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
