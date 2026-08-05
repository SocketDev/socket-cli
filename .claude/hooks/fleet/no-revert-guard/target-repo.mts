/*
 * @file Which repository a destructive `git` command acts on.
 *
 *   `git -C <other-repo> reset --hard HEAD~1` rewrites <other-repo>, not the
 *   checkout the Bash call started in. Every work-loss fact the guard gathers —
 *   the commits ahead of the reset target, the files only HEAD carries, the
 *   refs that would still hold them — has to come from THERE. Reading the
 *   session's own checkout instead named this repo's HEAD as the at-risk commit
 *   and reported nothing preserving work a backup branch in the target held.
 *
 *   Resolution order: the destructive invocation's own `-C`, else the tool
 *   call's acted-on path (`actedOnPath`, which follows a `cd`), else the hook's
 *   project dir. The `-C` read is scoped to the destructive subcommands, so a
 *   `git -C <elsewhere> rev-parse` inside a `$(…)` substitution is not mistaken
 *   for the target. One `-C` parser fleet-wide: `_shared/git-cwd.mts`.
 */

import { actedOnPath } from '../_shared/fleet-context.mts'
import { gitOut } from '../_shared/git-branch.mts'
import { extractGitDashCDir } from '../_shared/git-cwd.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'

/**
 * The `git` subcommands whose `-C` decides which repository this guard reads —
 * the verbs `destructiveShape` blocks.
 */
export const DESTRUCTIVE_GIT_SUBCOMMANDS: readonly string[] = [
  'checkout',
  'clean',
  'reset',
  'restore',
  'rm',
  'stash',
]

export interface DestructiveGitTargetConfig {
  readonly command: string
  readonly payload: ToolCallPayload
}

/**
 * The directory a destructive `git` command runs in.
 */
export function resolveDestructiveGitDir(
  config: DestructiveGitTargetConfig,
): string {
  const { command, payload } = {
    __proto__: null,
    ...config,
  } as DestructiveGitTargetConfig
  // The acted-on path is both the no-`-C` answer and the base a RELATIVE `-C`
  // resolves against: a cd into one directory then a `-C sub` lands in its
  // `sub` child, matching what the shell would do.
  const base = actedOnPath(payload)
  return (
    extractGitDashCDir(command, {
      cwd: base,
      subcommand: DESTRUCTIVE_GIT_SUBCOMMANDS,
    }) ?? base
  )
}

/**
 * The root of the repository a destructive `git` command acts on, or undefined
 * when the directory is not a git repo / git is unavailable. The caller reads
 * that undefined as "can't tell", which never manufactures a block.
 */
export function resolveDestructiveGitRepoRoot(
  config: DestructiveGitTargetConfig,
): string | undefined {
  return gitOut(resolveDestructiveGitDir(config), [
    'rev-parse',
    '--show-toplevel',
  ])
}
