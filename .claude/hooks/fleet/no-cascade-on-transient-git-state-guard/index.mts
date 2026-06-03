#!/usr/bin/env node
// Claude Code PreToolUse hook — no-cascade-on-transient-git-state-guard.
//
// Blocks a cascade-shaped `git commit` when the target repo is in a
// transient git state — detached HEAD or in-progress rebase / merge /
// cherry-pick. Committing in that state lands the cascade on a stale or
// throwaway ref instead of the branch tip, stranding the commit and
// corrupting another session's in-flight operation.
//
// Why this exists: 2026-06-02 a fleet cascade's manual commit loop ran
// `git commit -m "chore(wheelhouse): cascade template@<sha>"` across
// every fleet repo. socket-lib was mid-`git cherry-pick` on a detached
// HEAD (another session's work); the loop ignored that and committed the
// cascade onto the detached HEAD, breaking the cherry-pick sequencer.
// sync-scaffolding's own auto-commit already skips this state — but a
// hand-typed loop bypassed that check. This hook enforces it at the Bash
// layer so NO commit path (script, loop, or manual) can land a cascade on
// a transient ref.
//
// Skipped silently:
//   - tool_name !== 'Bash'.
//   - Command isn't a cascade-prefixed `git commit`.
//   - Target repo is on a normal branch tip (the common case).
//
// No bypass: there is never a legitimate reason to land a cascade commit
// on a transient ref. Finish (or abort) the in-progress operation first.
//
// Exit codes:
//   0  — allow.
//   2  — block. Stderr carries the operator-facing message.
//
// Fails open on any internal error (exit 0 + stderr log).

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import process from 'node:process'

import { extractGitCwd } from '../_shared/git-cwd.mts'
import { isInTransientGitState } from '../_shared/git-state.mts'
import { withBashGuard } from '../_shared/payload.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const logger = getDefaultLogger()

const CASCADE_PREFIX = 'chore(wheelhouse): cascade template@'

/**
 * Extract the `-m` / `--message` value from a `git commit` invocation, if any.
 * Returns the first message argument or undefined.
 */
export function commitMessage(command: string): string | undefined {
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('commit')) {
      continue
    }
    for (let i = 0, { length } = c.args; i < length; i += 1) {
      const a = c.args[i]
      if ((a === '-m' || a === '--message') && c.args[i + 1] !== undefined) {
        return c.args[i + 1]
      }
      if (a?.startsWith('--message=')) {
        return a.slice('--message='.length)
      }
    }
  }
  return undefined
}

await withBashGuard((command, _payload) => {
  const message = commitMessage(command)
  if (message === undefined || !message.startsWith(CASCADE_PREFIX)) {
    return
  }
  const repoDir = extractGitCwd(command)
  if (!isInTransientGitState(repoDir)) {
    return
  }
  logger.error(
    [
      '[no-cascade-on-transient-git-state-guard] Blocked: cascade commit on a transient git ref.',
      '',
      `  Repo:    ${repoDir}`,
      '  State:   detached HEAD or in-progress rebase / merge / cherry-pick.',
      '',
      '  Committing a cascade here lands it on a stale or throwaway ref,',
      "  strands the commit, and can corrupt another session's in-flight",
      '  operation (this stranded a cascade on socket-lib mid cherry-pick',
      '  on 2026-06-02).',
      '',
      '  Fix: finish or abort the in-progress operation, get the repo back',
      '  on its branch tip, then re-run the cascade. No bypass.',
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
