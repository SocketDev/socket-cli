#!/usr/bin/env node
// Claude Code PreToolUse hook — no-empty-commit-guard.
//
// Blocks two empty-commit shapes the fleet bans (see CLAUDE.md
// "Commits & PRs → No empty commits"):
//
//   1. `git commit --allow-empty` (with or without `-m`).
//   2. `git cherry-pick --allow-empty` / `--keep-redundant-commits`
//      against a ref whose patch is empty relative to HEAD.
//
// Why blocking, not reminder: empty commits pollute `git log`, break
// CHANGELOG generators (which expect each commit to carry a diff),
// and hide intent ("did the author mean to anchor a tag? amend a
// previous commit? something else?"). The canonical way to anchor
// a release tag forward is `git tag -f vX.Y.Z` against the actual
// content commit, not a fake "anchor" commit with no diff.
//
// Skipped silently:
//   - tool_name !== 'Bash'.
//   - Command doesn't contain `git commit` or `git cherry-pick`.
//   - Bypass phrase present in recent transcript turns.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/path/to/jsonl",  // optional
//     ... }
//
// Exit codes:
//   0  — allow.
//   2  — block. Stderr carries the operator-facing message.
//
// squash-history repos (roster opt-in) are EXEMPT — no bypass needed: every
// commit collapses into the lone `chore: initial commit`, so an empty commit is
// absorbed by the next squash and never reaches the log/CHANGELOG this protects.
//
// Fails open on any internal error (exit 0 + stderr log) so the
// hook never wedges the operator's flow.

import { isSquashOptIn } from '../_shared/fleet-roster.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor, commandWorkingDir } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow empty-commit bypass'

/**
 * Detect `git commit --allow-empty` (and `--allow-empty-message`, which is the
 * same antipattern — both produce a no-op commit). Parser-based: the flag must
 * belong to a real `git commit` invocation, so a literal `--allow-empty` in a
 * commit-message body or a sibling command doesn't false-positive.
 */
export function isAllowEmptyCommit(command: string): boolean {
  return commandsFor(command, 'git').some(
    c =>
      c.args.includes('commit') &&
      c.args.some(a => a === '--allow-empty' || a === '--allow-empty-message'),
  )
}

/**
 * Detect `git cherry-pick --allow-empty` or `--keep-redundant-commits` — both
 * replay a no-content commit forward into the current branch, which is exactly
 * the empty-commit pattern the rule bans.
 */
export function isCherryPickAllowEmpty(command: string): boolean {
  return commandsFor(command, 'git').some(
    c =>
      c.args.includes('cherry-pick') &&
      c.args.some(
        a => a === '--allow-empty' || a === '--keep-redundant-commits',
      ),
  )
}

export const check = bashGuard((command, payload) => {
  const allowEmptyCommit = isAllowEmptyCommit(command)
  const allowEmptyCherryPick = isCherryPickAllowEmpty(command)
  if (!allowEmptyCommit && !allowEmptyCherryPick) {
    return undefined
  }

  // squash-history repos (roster opt-in) collapse ALL commits into the one
  // canonical `chore: initial commit` — an empty commit is absorbed on the next
  // squash, so it never reaches the `git log` / CHANGELOG the ban protects. No
  // bypass needed there; the rationale simply doesn't apply.
  if (isSquashOptIn(commandWorkingDir(command))) {
    return undefined
  }

  // Operator bypass — `Allow empty-commit bypass` in a recent turn.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }

  const flag = allowEmptyCommit
    ? '--allow-empty (or --allow-empty-message)'
    : '--allow-empty / --keep-redundant-commits'
  return block(
    [
      `[no-empty-commit-guard] Blocked: git ${allowEmptyCommit ? 'commit' : 'cherry-pick'} ${flag}`,
      '',
      '  Empty commits pollute `git log`, break CHANGELOG generators',
      '  (which expect each commit to carry a diff), and hide intent.',
      '',
      '  If you are anchoring a release tag forward, use:',
      '    git tag -f vX.Y.Z <real-content-commit>',
      '    git push origin --force-with-lease vX.Y.Z',
      '',
      '  If you genuinely need to record a no-content waypoint, type',
      `  "${BYPASS_PHRASE}" in chat, then retry.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
