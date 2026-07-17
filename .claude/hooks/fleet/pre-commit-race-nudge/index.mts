#!/usr/bin/env node
// Claude Code PreToolUse hook — pre-commit-race-nudge.
//
// Nudges away from reflexively reaching for `git commit --no-verify` when the
// real failure is a parallel session racing the shared `.git/` index, not a
// genuine pre-commit failure on your own change.
//
// Incident (2026-06-04): two commits used --no-verify because a sibling
// worktree session's pre-commit kept racing the shared `.git/` index on a
// dangling `_local-not-for-reuse-ci.yml` object — reproducible, not the agent's
// change. The agent verified each tree green independently before bypassing, but
// --no-verify is a blunt instrument: it skips ALL validation, so a real failure
// in your own change would slip through too. The right move for an index race is
// to RETRY (the lock clears when the other session's git op finishes) or commit
// from an isolated index — not to disable the gate.
//
// This is a REMINDER (exit 0 + stderr), not a block — `--no-verify` is already
// gated behind the `Allow no-verify bypass` phrase by no-revert-guard. This hook
// only fires when that bypass is in play, to steer the recovery.
//
// Fires on Bash `git commit ... --no-verify` (or `-n`). Stays silent for
// FLEET_SYNC=1 cascade commits (the documented --no-verify exception).

import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import {
  invocationHasFlag,
  isFleetSyncCommand,
} from '../_shared/shell-command.mts'

const NO_VERIFY_FLAGS = ['--no-verify', '-n']

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    // Cascade commits legitimately use --no-verify (FLEET_SYNC=1 exception).
    if (isFleetSyncCommand(command)) {
      return undefined
    }
    if (!isGitCommit(command)) {
      return undefined
    }
    if (!invocationHasFlag(command, 'git', NO_VERIFY_FLAGS)) {
      return undefined
    }
    void payload
    return notify(
      [
        '[pre-commit-race-nudge] `git commit --no-verify` detected.',
        '',
        'If pre-commit failed with `index.lock`, `bad object`, `cannot lock',
        'ref`, or `unable to write new index`, that is a PARALLEL session',
        "racing the shared `.git/` — not a failure in your change. Don't",
        'disable the gate; instead:',
        '',
        '  1. Retry the commit — the lock clears when the other git op ends.',
        '  2. Or commit from an isolated index:',
        '       GIT_INDEX_FILE=$(mktemp) git add -- <file> && \\',
        '       GIT_INDEX_FILE=<same> git commit -o <file> -m "..."',
        '',
        '`--no-verify` skips ALL validation, so a real problem in YOUR change',
        'slips through too. Reserve it for when pre-commit is genuinely broken',
        '(not racing) AND you have already:',
        '',
        '  - retried at least once (step 1) — the lock usually clears,',
        '  - confirmed the tree is sound independently:',
        '      git write-tree            # clean, no error',
        '      pnpm test                 # green',
        '      node_modules/.bin/oxfmt --check <changed files>   # clean',
        '',
        'Retrying first is the cleaner call; --no-verify is the last resort,',
        'and it still needs the `Allow no-verify bypass` phrase.',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})
void runHook(hook, import.meta.url)
