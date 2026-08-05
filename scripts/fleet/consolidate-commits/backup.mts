/*
 * @file The pre-rewrite safety net for `consolidate-commits.mts`.
 *
 *   Consolidating replaces commit identities, so the tip that existed before
 *   the rewrite has to survive somewhere durable. That somewhere is the fleet's
 *   canonical backup branch, `refs/heads/backup-YYYYMMDD-HHMMSS`: named by
 *   `../backup-branches/naming.mts`, retired by `backup-branches.mts prune`,
 *   renamed to canonical form by `backup-branches.mts normalize`, and scanned
 *   at release time by `../bump.mts` so parked work is never shipped past
 *   silently.
 *
 *   Three outcomes, in the order they are attempted:
 *
 *   1. An `origin` remote exists and the push lands — the backup is on origin,
 *      recoverable from any clone.
 *   2. An `origin` remote exists and the push FAILS — the safety net does not
 *      exist, so the caller must abort before rewriting anything.
 *   3. No `origin` remote — the backup is written as a LOCAL branch under the
 *      same canonical name, and the caller is told it is local-only.
 *
 *   Every function takes its git runner as a parameter, so the whole decision
 *   tree is testable with no remote and no fixture repo.
 */

import { formatBackupBranch } from '../backup-branches/naming.mts'

const LABEL = '[consolidate-commits]'

/**
 * One git invocation's outcome, the shape `consolidate-commits.mts` captures.
 */
export interface BackupGitResult {
  status: number
  stderr: string
  stdout: string
}

/**
 * A git runner injected so the backup decisions stay testable. Same seam
 * convention as `GitExec` in `../backup-branches/prune.mts`, synchronous
 * because the consolidate flow's git plumbing runs step by step.
 */
export type BackupGitExec = (args: readonly string[]) => BackupGitResult

/**
 * Where the pre-rewrite tip ended up parked.
 */
export type BackupDestination = 'local' | 'origin'

/**
 * The parked pre-rewrite tip.
 */
export interface PreRewriteBackup {
  readonly branch: string
  readonly destination: BackupDestination
  readonly ref: string
  readonly tip: string
}

/**
 * Either the backup exists — with a warning when it only exists locally — or it
 * does not and the caller must rewrite nothing.
 */
export type PreRewriteBackupOutcome =
  | {
      readonly backup: PreRewriteBackup
      readonly ok: true
      readonly warning: string | undefined
    }
  | { readonly error: string; readonly ok: false }

/**
 * The canonical backup-branch name for a commit, derived from that commit's own
 * committer date so re-running against the same tip picks the same name.
 * Undefined when the commit date cannot be read or parsed.
 */
export function backupBranchForCommit(
  exec: BackupGitExec,
  sha: string,
): string | undefined {
  const read = exec(['show', '-s', '--format=%cI', sha])
  if (read.status !== 0 || !read.stdout) {
    return undefined
  }
  try {
    return formatBackupBranch(read.stdout)
  } catch {
    return undefined
  }
}

/**
 * True when the checkout has an `origin` remote to push a backup to.
 */
export function hasOriginRemote(exec: BackupGitExec): boolean {
  return exec(['remote', 'get-url', 'origin']).status === 0
}

/**
 * The message for a tip whose commit date git would not hand over.
 */
export function unreadableTipMessage(tip: string): string {
  return (
    `${LABEL} could not name a backup branch for the pre-rewrite tip.\n` +
    `  What:   the backup branch is named from the tip commit's own date, and that date could not be read.\n` +
    `  Where:  git show -s --format=%cI ${tip.slice(0, 12)}\n` +
    `  Saw:    no usable ISO commit date.\n` +
    `  Wanted: a canonical backup-YYYYMMDD-HHMMSS name for the tip before rewriting anything.\n` +
    `  Fix:    check that ${tip.slice(0, 12)} resolves in this checkout (git cat-file -t ${tip.slice(0, 12)}), then re-run. Nothing was rewritten.`
  )
}

/**
 * The message for a backup push origin rejected. A rewrite with no recoverable
 * copy of the original history is the exact outcome the backup exists to stop,
 * so this always aborts the consolidate.
 */
export function pushFailedMessage(config: {
  branch: string
  result: BackupGitResult
  tip: string
}): string {
  const cfg = { __proto__: null, ...config } as {
    branch: string
    result: BackupGitResult
    tip: string
  }
  const { branch, result, tip } = cfg
  const detail = result.stderr || result.stdout || '(no output)'
  return (
    `${LABEL} the pre-rewrite backup push failed — nothing was rewritten.\n` +
    `  What:   the original tip could not be parked on origin, so the consolidation would have no recoverable copy of the history it replaces.\n` +
    `  Where:  git push origin ${tip.slice(0, 12)}:refs/heads/${branch}\n` +
    `  Saw:    exit ${result.status}: ${detail}\n` +
    `  Wanted: the original tip on origin BEFORE the rewrite, so a bad consolidation is always undoable from any clone.\n` +
    `  Fix:    clear the push failure (auth: gh auth status; branch protection; network), then re-run.`
  )
}

/**
 * The message for a local backup that could not be written.
 */
export function localBackupFailedMessage(config: {
  branch: string
  reason: string
  tip: string
}): string {
  const cfg = { __proto__: null, ...config } as {
    branch: string
    reason: string
    tip: string
  }
  const { branch, reason, tip } = cfg
  return (
    `${LABEL} the local pre-rewrite backup could not be written — nothing was rewritten.\n` +
    `  What:   this checkout has no origin remote, so the backup has to be a local branch, and writing it failed.\n` +
    `  Where:  refs/heads/${branch} -> ${tip.slice(0, 12)}\n` +
    `  Saw:    ${reason}\n` +
    `  Wanted: the original tip reachable from a canonical backup branch before the rewrite.\n` +
    `  Fix:    resolve the conflict above (rename or delete the existing branch), then re-run.`
  )
}

/**
 * The warning for a backup that only exists in this checkout.
 */
export function localOnlyWarning(branch: string): string {
  return (
    `${LABEL} the backup ${branch} is LOCAL ONLY — this checkout has no origin remote to push it to.\n` +
    `  What:   the pre-rewrite tip is parked on a local branch and exists nowhere else.\n` +
    `  Where:  refs/heads/${branch}\n` +
    `  Saw:    git remote get-url origin found no remote.\n` +
    `  Wanted: the backup on origin, recoverable from any clone.\n` +
    `  Fix:    add an origin remote and push ${branch} if this history matters beyond this machine.`
  )
}

/**
 * The one-line recovery instruction printed beside a finished consolidation.
 */
export function backupRecoveryHint(backup: PreRewriteBackup): string {
  return backup.destination === 'origin'
    ? `git fetch origin ${backup.branch} && git reset --hard FETCH_HEAD`
    : `git reset --hard ${backup.branch}`
}

/**
 * Park the pre-rewrite tip on a canonical backup branch. Push to origin when
 * there is one; fall back to a local branch of the same name when there is not.
 * A failed push is a failed safety net, never a warning — the caller aborts.
 */
export function createPreRewriteBackup(config: {
  exec: BackupGitExec
  tip: string
}): PreRewriteBackupOutcome {
  const cfg = { __proto__: null, ...config } as {
    exec: BackupGitExec
    tip: string
  }
  const { exec, tip } = cfg
  const branch = backupBranchForCommit(exec, tip)
  if (!branch) {
    return { error: unreadableTipMessage(tip), ok: false }
  }
  const ref = `refs/heads/${branch}`
  if (hasOriginRemote(exec)) {
    // --no-verify: a backup ref carries only existing, already-validated
    // history, and the repo's pre-push hook needs an installed dependency tree
    // that a bare or freshly cloned checkout may not have.
    const pushed = exec(['push', '--no-verify', 'origin', `${tip}:${ref}`])
    if (pushed.status !== 0) {
      return {
        error: pushFailedMessage({ branch, result: pushed, tip }),
        ok: false,
      }
    }
    return {
      backup: { branch, destination: 'origin', ref, tip },
      ok: true,
      warning: undefined,
    }
  }
  // A same-named local branch pointing somewhere else means a different tip
  // already owns this second of the clock. Overwriting it would destroy the
  // older backup, so refuse instead.
  const existing = exec(['rev-parse', '--verify', '--quiet', ref])
  if (existing.status === 0 && existing.stdout && existing.stdout !== tip) {
    return {
      error: localBackupFailedMessage({
        branch,
        reason: `${ref} already exists and points at ${existing.stdout.slice(0, 12)}, not the tip being backed up.`,
        tip,
      }),
      ok: false,
    }
  }
  const written = exec(['update-ref', ref, tip])
  if (written.status !== 0) {
    return {
      error: localBackupFailedMessage({
        branch,
        reason: `git update-ref exited ${written.status}: ${written.stderr || '(no output)'}`,
        tip,
      }),
      ok: false,
    }
  }
  return {
    backup: { branch, destination: 'local', ref, tip },
    ok: true,
    warning: localOnlyWarning(branch),
  }
}
