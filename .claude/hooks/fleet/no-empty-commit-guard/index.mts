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
// Fails open on any internal error (exit 0 + stderr log) so the
// hook never wedges the operator's flow.

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import { withBashGuard } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

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

// withBashGuard handles the stdin drain, tool_name gate, command narrow,
// and fail-open on any throw.
await withBashGuard((command, payload) => {
  const allowEmptyCommit = isAllowEmptyCommit(command)
  const allowEmptyCherryPick = isCherryPickAllowEmpty(command)
  if (!allowEmptyCommit && !allowEmptyCherryPick) {
    return
  }

  // Operator bypass — `Allow empty-commit bypass` in a recent turn.
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }

  const flag = allowEmptyCommit
    ? '--allow-empty (or --allow-empty-message)'
    : '--allow-empty / --keep-redundant-commits'
  logger.error(
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
  process.exitCode = 2
})
