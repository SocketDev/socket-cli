#!/usr/bin/env node
// Claude Code Stop hook — no-orphaned-staging.
//
// Fires at turn-end. Checks `git diff --cached --name-only` in
// $CLAUDE_PROJECT_DIR. If anything is staged but uncommitted, emits
// a stderr warning listing the orphaned paths.
//
// The fleet rule (CLAUDE.md "Don't leave the worktree dirty"):
//
//   Stage only when you're about to commit. `git add` and `git
//   commit` belong on the same line (chained with `&&`) OR in the
//   same Bash call. Don't stage as a side-effect of "preparing"
//   — staging is a commit-time action.
//
// A turn that ends with staged-but-uncommitted hunks tends to be
// either:
//   (a) the agent forgot the commit half of `git add && git commit`,
//   (b) a failed pre-commit hook unstuck the index, or
//   (c) the agent staged "for later" — exactly what this rule
//       forbids.
//
// All three are the same failure mode: the next session sees an
// already-staged index and has to figure out the intent. The
// reminder makes the dangling state visible at the very turn that
// created it.
//
// Verdict: notify (never blocks). Stop hooks fire AFTER the turn
// ended; there's no tool call to refuse. The signal goes to stderr so
// the next message includes the warning. The agent can then either
// commit or explicitly explain why the staged state is intentional.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { defineHook, notify, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'

export function getProjectDir(): string | undefined {
  // Prefer the harness-supplied env (correct even when cwd has been
  // chdir'd by a tool). Fall back to cwd.
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

export function listStagedFiles(repoDir: string): string[] {
  const r = spawnSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoDir,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return []
  }
  return String(r.stdout)
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean)
}

export const check = (): GuardResult => {
  const repoDir = getProjectDir()
  /* c8 ignore start - getProjectDir() always falls back to process.cwd(), which is never empty */
  if (!repoDir) {
    return undefined
  }
  /* c8 ignore stop */

  const staged = listStagedFiles(repoDir)
  if (staged.length === 0) {
    return undefined
  }

  let message =
    '[no-orphaned-staging] Turn ended with staged-but-uncommitted files:\n'
  for (const f of staged.slice(0, 10)) {
    message += `  - ${f}\n`
  }
  if (staged.length > 10) {
    message += `  ... and ${staged.length - 10} more\n`
  }
  message +=
    '\nFleet rule: stage only when about to commit. Either:\n' +
    '  • Run `git commit` to finish the work, OR\n' +
    '  • Run `git reset` to unstage (keep changes in working tree).\n' +
    '\nCLAUDE.md → "Don\'t leave the worktree dirty" → "Stage only when ' +
    'you\'re about to commit".\n'

  return notify(message)
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
