#!/usr/bin/env node
// Claude Code PreToolUse hook — corrupt-rebase-guard.
//
// Blocks `--continue` / `--skip` for any paused sequencer (cherry-pick, merge,
// rebase, revert) whose index holds a wipe. Observed live: a rebase stopped in
// a shared checkout with 8,006 files staged for deletion while the commit it
// was applying touched 2. Continuing would have recorded that onto the branch.
//
// Every verb reads its OWN pseudo-ref for the stopped commit. Reading
// `REBASE_HEAD` for all of them looks like it works - the volume check still
// fires - while the disproportion signal is dead for three verbs, which is the
// half that catches a corrupt index below the deletion floor.
//
// Why the deletion gates that already exist did not catch it: every one of
// them keys on `git commit`. `--continue` records a commit through git's own
// machinery and never spells that word, so it walked straight past
// mass-delete-guard and the .git-hooks staged gate. The hole was the command
// name, not the detection.
//
// The judgment lives in `rebase-shape.mts` (pure, unit-tested). This file only
// gathers the two counts: staged deletions now, and the file count of the
// commit the rebase stopped on. `--abort` is never blocked — it is the
// recovery path out of exactly the state this guard reports.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  bashGuard,
  block,
  defineHook,
  notify,
  runHook,
} from '../_shared/guard.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { verdictLine } from '../_shared/verdict.mts'
import {
  corruptRebaseReason,
  isVerificationCommand,
  SEQUENCER_HEAD_REFS,
  SEQUENCER_OPS,
  sequencerContinuation,
} from './rebase-shape.mts'

import type { SequencerOp } from './rebase-shape.mts'

/**
 * Budget for each git read below. These are local plumbing calls against an
 * index git already has open, so a slow answer means something is wrong rather
 * than something is big; the guard fails open instead of hanging the tool call.
 */
const GIT_READ_TIMEOUT_MS = 5000

function gitLines(args: readonly string[]): string[] {
  try {
    const result = spawnSync('git', [...args], {
      stdio: 'pipe',
      stdioString: true,
      timeout: spawnTimeoutMs(GIT_READ_TIMEOUT_MS),
    })
    if (result.status !== 0 || typeof result.stdout !== 'string') {
      return []
    }
    return result.stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Files staged for deletion right now.
 */
export function stagedDeletionCount(): number {
  return gitLines(['diff', '--cached', '--diff-filter=D', '--name-only']).length
}

/**
 * How many files the commit the sequencer stopped on touches, or undefined when
 * the sha cannot be read.
 *
 * Undefined is meaningful: it disables the disproportion signal rather than
 * the whole guard, so an unreadable commit degrades to the volume check.
 * `ref` is the paused operation's own pseudo-ref, which is git's name for the
 * stopped commit — `REBASE_HEAD` resolves the same under a rebase-merge or a
 * rebase-apply layout, so no state directory is read by hand.
 */
export function stoppedCommitFileCount(ref: string): number | undefined {
  const stopped = gitLines(['rev-parse', '--verify', '--quiet', ref])[0]
  if (!stopped) {
    return undefined
  }
  return gitLines(['--no-pager', 'show', '--name-only', '--format=', stopped])
    .length
}

/**
 * The sequencer git is partway through, or undefined when the tree is settled.
 * Each pseudo-ref exists only while its operation is paused.
 */
export function pausedSequencer(): SequencerOp | undefined {
  for (let i = 0, { length } = SEQUENCER_OPS; i < length; i += 1) {
    const op = SEQUENCER_OPS[i]!
    const ref = SEQUENCER_HEAD_REFS[op]
    if (gitLines(['rev-parse', '--verify', '--quiet', ref])[0]) {
      return op
    }
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  // A verification read mid-sequencer reports the half-replayed working tree,
  // not committed state, and the output looks identical either way. Notice,
  // never block: reading the error IS how a conflict gets resolved.
  if (isVerificationCommand(command)) {
    const paused = pausedSequencer()
    if (!paused) {
      return undefined
    }
    void payload
    return notify(
      verdictLine(
        'warn',
        'corrupt-rebase-guard',
        `a ${paused} is paused, so this reads the half-replayed tree rather than committed state — a failure here may be a commit not yet replayed, so re-run it once the ${paused} finishes before believing it\n`,
      ),
    )
  }
  const resuming = sequencerContinuation(command)
  if (!resuming) {
    return undefined
  }
  const stagedDeletions = stagedDeletionCount()
  if (!stagedDeletions) {
    return undefined
  }
  // Read the pseudo-ref of the operation actually paused, not the one named in
  // the command: a stale `git rebase --continue` typed during a cherry-pick
  // should still be judged against the cherry-pick's stopped commit.
  const paused = pausedSequencer() ?? resuming
  const reason = corruptRebaseReason({
    stagedDeletions,
    stoppedCommitFiles: stoppedCommitFileCount(SEQUENCER_HEAD_REFS[paused]),
  })
  if (!reason) {
    return undefined
  }

  void payload

  return block(
    verdictLine(
      'block',
      'corrupt-rebase-guard',
      `continuing this ${paused} would record a wipe — ${reason}. \`git ${paused} --abort\` returns the branch to where it started with every commit intact; read the state first with \`git status\` and \`git diff --cached --diff-filter=D --name-only | wc -l\`\n`,
    ),
  )
})

export const hook = defineHook({
  bypass: ['corrupt-rebase'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
