/*
 * @file Decide whether a paused rebase is safe to continue.
 *
 *   The failure this exists to stop, observed live: an interactive rebase in a
 *   shared checkout stopped mid-run with 8,006 files staged for deletion while
 *   the commit it was applying touched 2. Running `git rebase --continue` there
 *   would have recorded the wipe. Nothing caught it, because every existing
 *   deletion gate keys on `git commit`, and `--continue` commits through git's
 *   own machinery without ever spelling that word.
 *
 *   Two independent signals, either of which condemns the state:
 *
 *   - VOLUME. Deletions at or past the floor are a wipe on their own, the same
 *     threshold the commit-time gate uses. Kept equal to it on purpose: one
 *     number for "this many deletions is never routine", not two that drift.
 *   - DISPROPORTION. The stopped commit's own diff is the honest expectation
 *     for how many files should move. Deletions far past it mean the index
 *     holds something the commit never asked for, which is the exact 2-vs-8006
 *     shape. This catches a corrupt state well below the volume floor.
 *
 *   Deliberately NOT a judgment about rebasing. A rebase that legitimately
 *   drops many files still trips this, and that is the intended cost: the
 *   operator confirms once, rather than every actor after them inheriting a
 *   landmine. Untracking is already discriminated upstream by
 *   `benign-untracking.mts`, so a `git rm --cached` sweep does not reach here.
 */

import { commandsFor } from '../_shared/shell-command.mts'

/**
 * Deletions that are never routine, matching the commit-time gate's floor in
 * `.git-hooks/_shared/staged-gates.mts` so the two cannot drift apart.
 */
export const DELETE_FLOOR = 50

/**
 * How far past the stopped commit's own file count the staged deletions may
 * run before the index is holding something the commit did not ask for.
 */
export const DISPROPORTION_FACTOR = 20

/**
 * The smallest deletion count worth judging by disproportion. Below this a
 * small commit touching one file legitimately deletes a handful around it.
 */
export const DISPROPORTION_FLOOR = 10

export interface PausedRebase {
  /**
   * Files staged for deletion right now.
   */
  stagedDeletions: number
  /**
   * Files the commit the rebase stopped on touches, or undefined when it could
   * not be read. Undefined disables the disproportion signal, never the volume
   * one, so an unreadable commit degrades to the weaker check rather than to
   * silence.
   */
  stoppedCommitFiles?: number | undefined
}

/**
 * Why continuing this rebase would record a wipe, or undefined when the staged
 * state is proportionate to the commit being applied.
 *
 * Pure, so the thresholds are testable without a repository.
 */
export function corruptRebaseReason(state: PausedRebase): string | undefined {
  const { stagedDeletions, stoppedCommitFiles } = state
  if (stagedDeletions >= DELETE_FLOOR) {
    return `${stagedDeletions} files staged for deletion (at or past the ${DELETE_FLOOR} floor)`
  }
  if (
    stoppedCommitFiles !== undefined &&
    stagedDeletions >= DISPROPORTION_FLOOR &&
    stagedDeletions > stoppedCommitFiles * DISPROPORTION_FACTOR
  ) {
    return `${stagedDeletions} files staged for deletion while the commit being applied touches ${stoppedCommitFiles}`
  }
  return undefined
}

/**
 * The subcommand a `git rebase` invocation is performing, or undefined when the
 * command is not a rebase continuation.
 *
 * Only `--continue` and `--skip` record a commit from the current index, so
 * they are the shapes this guard judges. `--abort` is the recovery path and is
 * always allowed; starting a rebase stages nothing yet. Parsed with the shared
 * shell AST rather than a pattern, so a chained or quoted invocation reads the
 * same as a bare one.
 */
export function rebaseContinuation(
  command: string,
): 'continue' | 'skip' | undefined {
  return sequencerContinuation(command) ? continuationKind(command) : undefined
}

/**
 * Every git operation that replays commits one at a time and can pause. All
 * four record a commit from the current index on `--continue`, so all four
 * carry the same wipe risk; `rebase` was simply the one seen first.
 */
export const SEQUENCER_OPS = Object.freeze([
  'cherry-pick',
  'merge',
  'rebase',
  'revert',
] as const)

export type SequencerOp = (typeof SEQUENCER_OPS)[number]

/**
 * The pseudo-ref git writes for each sequencer, naming the commit it stopped
 * on. Each exists only while its operation is paused, so the presence of one
 * both detects the pause and identifies which operation it belongs to.
 *
 * Reading the ref that matches the paused op is what keeps the disproportion
 * signal alive past rebase: `REBASE_HEAD` does not exist during a cherry-pick,
 * so a lookup hardcoded to it silently degraded every non-rebase sequencer to
 * the volume check alone — a corrupt cherry-pick under the floor passed clean.
 */
export const SEQUENCER_HEAD_REFS: Readonly<Record<SequencerOp, string>> =
  Object.freeze({
    __proto__: null,
    'cherry-pick': 'CHERRY_PICK_HEAD',
    merge: 'MERGE_HEAD',
    rebase: 'REBASE_HEAD',
    revert: 'REVERT_HEAD',
  } as Record<SequencerOp, string>)

/**
 * Which sequencer a command is resuming, or undefined when it is not resuming
 * one.
 *
 * Generalized past `rebase` on purpose: `cherry-pick --continue`,
 * `merge --continue`, and `revert --continue` all commit the staged index
 * through git's own machinery, so a guard that watched only rebase would keep
 * the exact hole it was written to close. A live cherry-pick during this
 * module's own development is what surfaced the omission.
 */
export function sequencerContinuation(
  command: string,
): SequencerOp | undefined {
  const gitCommands = commandsFor(command, 'git')
  for (let i = 0, { length } = gitCommands; i < length; i += 1) {
    const { args } = gitCommands[i]!
    if (!args.includes('--continue') && !args.includes('--skip')) {
      continue
    }
    for (let j = 0, opCount = SEQUENCER_OPS.length; j < opCount; j += 1) {
      const op = SEQUENCER_OPS[j]!
      if (args.includes(op)) {
        return op
      }
    }
  }
  return undefined
}

/**
 * Whether a resuming command commits (`--continue`) or drops (`--skip`).
 */
export function continuationKind(
  command: string,
): 'continue' | 'skip' | undefined {
  const gitCommands = commandsFor(command, 'git')
  for (let i = 0, { length } = gitCommands; i < length; i += 1) {
    const { args } = gitCommands[i]!
    if (args.includes('--continue')) {
      return 'continue'
    }
    if (args.includes('--skip')) {
      return 'skip'
    }
  }
  return undefined
}

/**
 * Commands whose output is only meaningful against a settled tree.
 *
 * Read mid-sequencer, each one reports the half-replayed working tree rather
 * than committed state, and the difference is invisible in the output. That
 * misread happened here: a type error surfaced during a paused rebase, was
 * taken for a reverted commit, and a fix already queued for replay was written
 * a second time. The verdict is a notice, never a block, because reading a
 * type error IS how a conflict gets resolved.
 */
export function isVerificationCommand(command: string): boolean {
  const runners = [
    ...commandsFor(command, 'pnpm'),
    ...commandsFor(command, 'npm'),
    ...commandsFor(command, 'yarn'),
  ]
  for (let i = 0, { length } = runners; i < length; i += 1) {
    const { args } = runners[i]!
    if (
      args.includes('type') ||
      args.includes('lint') ||
      args.includes('check') ||
      args.includes('test')
    ) {
      return true
    }
  }
  return (
    commandsFor(command, 'tsc').length > 0 ||
    commandsFor(command, 'tsgo').length > 0 ||
    commandsFor(command, 'vitest').length > 0
  )
}
