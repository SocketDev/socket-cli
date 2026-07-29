/*
 * @file Shared `--fix` planner + executor for the untrack-offender check
 *   family (handoff-docs-are-untracked, tracked-symlinks-are-safe,
 *   upstream-gitlinks-are-absent, ignored-files-are-untracked). Each of those
 *   gates detects git-tracked paths that must leave the index, then used to
 *   prescribe the same manual `git rm --cached` / `git update-index
 *   --force-remove` dance with the offender paths already computed. This
 *   module folds that remedy into one seam: `planUntrackActions` is PURE —
 *   offenders + mode in, an ordered `{cmd, args}` action list out — so every
 *   check's fix plan unit-tests without touching a filesystem or a git repo;
 *   `executeUntrackActions` is a thin spawnSync loop that runs each action and
 *   collects the failures. Mode picks the remedy the check's invariant needs:
 *
 *   - `rm-cached` — `git rm --cached -- <path>` per offender. The working-copy
 *     entry stays; .gitignore keeps it untracked afterward (tracked symlinks).
 *   - `force-remove` — `git update-index --force-remove -- <path>` per offender.
 *     Drops the index entry unconditionally — works on gitlinks and on paths
 *     whose staged content diverged (where `git rm --cached` balks) — and keeps
 *     `.gitmodules` plus the working copy (upstream gitlinks, tracked-ignored
 *     files).
 *   - `move-to-plans` — one `mkdir -p <plansDir>`, then per offender `git rm
 *     --cached -- <path>` AND `mv <path> <plansDir>/` — the doc ends up
 *     untracked and rehomed under the gitignored operator-notes dir (handoff
 *     docs). Contract for callers: after executing, RE-RUN the detection —
 *     success is the re-check coming back clean, never the executor's word.
 *     Residual offenders keep the check's exit 1.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// One planned fix step: an argv-style command, never shell-interpolated.
export interface UntrackAction {
  args: string[]
  cmd: string
}

// One failed fix step: the action plus stderr (or the exit status when stderr
// is empty). Reported by the caller; the re-check still decides pass/fail.
export interface UntrackExecFailure {
  action: UntrackAction
  detail: string
}

export type UntrackMode = 'force-remove' | 'move-to-plans' | 'rm-cached'

// Default rehome target for `move-to-plans` — the gitignored operator-notes
// dir (mirrors PLANS_DIR in check/handoff-docs-are-untracked.mts).
const DEFAULT_PLANS_DIR = '.claude/plans'

/**
 * Plan the fix actions for `offenders` under `mode`. Pure — no IO — and
 * deterministic: actions come out in offender order, one (`force-remove` /
 * `rm-cached`) or two (`move-to-plans`) per offender, with a single leading
 * `mkdir -p` when a rehome dir is needed. Empty offenders → empty plan.
 */
export function planUntrackActions(
  offenders: readonly string[],
  mode: UntrackMode,
  options?: { plansDir?: string | undefined } | undefined,
): UntrackAction[] {
  const actions: UntrackAction[] = []
  if (offenders.length === 0) {
    return actions
  }
  const opts = { __proto__: null, ...options } as {
    plansDir?: string | undefined
  }
  const plansDir = opts.plansDir ?? DEFAULT_PLANS_DIR
  if (mode === 'move-to-plans') {
    // The rehome dir is gitignored, so a fresh clone won't have it yet.
    actions.push({ cmd: 'mkdir', args: ['-p', plansDir] })
  }
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    const offender = offenders[i]!
    if (mode === 'force-remove') {
      // Gitlinks and diverged-content paths need the unconditional drop;
      // `git rm --cached` refuses both. `.gitmodules` / working copy stay.
      actions.push({
        cmd: 'git',
        args: ['update-index', '--force-remove', '--', offender],
      })
    } else {
      actions.push({ cmd: 'git', args: ['rm', '--cached', '--', offender] })
      if (mode === 'move-to-plans') {
        actions.push({ cmd: 'mv', args: [offender, `${plansDir}/`] })
      }
    }
  }
  return actions
}

/**
 * One-line rendering of an action for failure output / logs.
 */
export function formatUntrackAction(action: UntrackAction): string {
  return `${action.cmd} ${action.args.join(' ')}`
}

/**
 * Run each planned action via spawnSync in `cwd`, collecting the failures
 * (non-zero exit). Deliberately thin: no retries, no rollback, no verdict —
 * the caller re-runs its detection and lets THAT decide success.
 */
export function executeUntrackActions(
  actions: readonly UntrackAction[],
  cwd: string,
): UntrackExecFailure[] {
  const failures: UntrackExecFailure[] = []
  for (let i = 0, { length } = actions; i < length; i += 1) {
    const action = actions[i]!
    const r = spawnSync(action.cmd, action.args, { cwd, stdioString: true })
    if (r.status !== 0) {
      const stderr = String(r.stderr ?? '').trim()
      failures.push({
        action,
        detail: stderr === '' ? `exit status ${String(r.status)}` : stderr,
      })
    }
  }
  return failures
}
