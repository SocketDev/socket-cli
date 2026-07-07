#!/usr/bin/env node
// Claude Code Stop hook — land-fast-nudge.
//
// Fires at turn-end. When the current checkout is ON the default branch
// (main / master) and local HEAD has DIVERGED from origin (it is BOTH
// ahead AND behind origin/<branch>), it nudges toward the fast-land path
// instead of a hand-rolled cherry-pick + force dance.
//
// Why: a diverged default branch is the state where a direct `git push`
// is rejected (non-fast-forward) and a `reset --hard origin/<branch>`
// would discard local work. It happens routinely in a parallel-session
// fleet: another session squashes your commits onto origin via PR (so
// origin gained commits your local doesn't have as the same SHAs), while
// your local kept the unsquashed originals. Hand-resolving this — manual
// cherry-pick onto a fresh worktree, verify fast-forward, push — is the
// exact friction the `managing-worktrees land` engine (lib/land.mts)
// automates: it re-asserts the lint gate (the fleet lints as it edits, so
// no heavy re-run), cherry-picks onto a throwaway origin/<base> worktree,
// and fast-forwards (never force). This reminder points there at the turn
// the divergence is visible.
//
// Only fires on the default branch when BOTH ahead AND behind: an
// ahead-only main is the unpushed-main-nudge's job (just push); a
// behind-only main just needs a pull; the diverged case is the one the
// fast-land path exists for.
//
// Exit codes: 0 — always (informational Stop hook). Fails open.

import process from 'node:process'

import {
  currentBranch,
  gitOut,
  isDefaultBranch,
} from '../_shared/git-branch.mts'
import { isSquashOptIn } from '../_shared/fleet-roster.mts'
import { defineHook, notify, runHook } from '../_shared/guard.mts'

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// Ahead / behind counts vs origin/<branch>. `git rev-list --left-right
// --count origin/<branch>...HEAD` prints "<behind>\t<ahead>". Returns
// undefined when there's no upstream to compare against.
export function aheadBehind(
  repoDir: string,
  branch: string,
): { ahead: number; behind: number } | undefined {
  const out = gitOut(repoDir, [
    'rev-list',
    '--left-right',
    '--count',
    `origin/${branch}...HEAD`,
  ])
  if (out === undefined) {
    return undefined
  }
  const parts = out.split(/\s+/)
  /* c8 ignore start - parts[0]/parts[1] are always defined for valid git output; ?? '' fallback and NaN guard are defensive-only and unreachable from a real git repo */
  const behind = Number.parseInt(parts[0] ?? '', 10)
  const ahead = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    return undefined
  }
  /* c8 ignore stop */
  return { ahead, behind }
}

// Diverged = BOTH ahead and behind. That's the non-fast-forward state the
// fast-land path is for; ahead-only / behind-only are not.
export function isDiverged(counts: { ahead: number; behind: number }): boolean {
  return counts.ahead > 0 && counts.behind > 0
}

export const check = () => {
  const repoDir = getProjectDir()
  const branch = currentBranch(repoDir)
  if (!branch || !isDefaultBranch(repoDir, branch)) {
    return undefined
  }
  const counts = aheadBehind(repoDir, branch)
  if (!counts || !isDiverged(counts)) {
    return undefined
  }
  // A squash-history repo's default branch is INTENTIONALLY diverged from
  // origin: origin holds the pre-squash history and local <branch> is
  // canonical. The fast-land cherry-pick-onto-origin path does NOT apply —
  // landing is a force-push. Point there instead of the fast-forward path.
  if (isSquashOptIn(repoDir)) {
    return notify(
      [
        `[land-fast-nudge] ${branch} is diverged from origin/${branch} ` +
          `(${counts.ahead} ahead, ${counts.behind} behind), but this is a`,
        `squash-history repo — local ${branch} is canonical and origin holds`,
        'the pre-squash history. Do NOT fast-land / cherry-pick onto origin.',
        'Land via the squashing-history force-push:',
        `    SQUASH_HISTORY=1 git push --force-with-lease origin ${branch}`,
        '',
        'The SQUASH_HISTORY sentinel must be in the hook process ENV (export it),',
        'not just an inline shell assignment — an inline `SQUASH_HISTORY=1 git`',
        'lives in the command string, which the PreToolUse no-force-push-guard',
        'does not read, so it still blocks. If it does, the bypass phrase is',
        '`Allow force-push bypass`.',
        '',
      ].join('\n'),
    )
  }
  return notify(
    [
      `[land-fast-nudge] ${branch} has DIVERGED from origin/${branch}: ` +
        `${counts.ahead} ahead, ${counts.behind} behind.`,
      '',
      'A direct push will be rejected, and `reset --hard` would discard local',
      'work (a parallel session likely squashed onto origin). Do NOT hand-roll',
      'a cherry-pick + force. Fast-land the local-only commits instead:',
      '    node .claude/skills/fleet/managing-worktrees/lib/land.mts --last <N>',
      '    node .claude/skills/fleet/managing-worktrees/lib/land.mts --last <N> --push',
      '',
      'It re-asserts the lint gate, cherry-picks onto a throwaway origin/' +
        `${branch} worktree, and fast-forwards (never force).`,
      '',
    ].join('\n'),
  )
}

export const hook = defineHook({
  check,
  event: 'Stop',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
