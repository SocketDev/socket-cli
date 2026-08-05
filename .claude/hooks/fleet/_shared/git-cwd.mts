/**
 * @file Resolve the directory a `git` command in a Bash string would run in.
 *   Shared by the fleet-push / fleet-PR / cascade-transient guards, which all
 *   need to know which repo a `git push` / `git commit` (or a `cd <dir> &&
 *   git ...`) targets before deciding. Parser-based (shell-command.mts): a
 *   regex sees a `git -C` inside a `$(…)` substitution and mis-attributes the
 *   whole command line to that repo — which false-blocked a legitimate
 *   cascade commit whose only `-C` lived in an embedded `rev-parse`
 *   substitution.
 */

import path from 'node:path'

import { gitSubcommand } from './git-subcommand.mts'
import { commandsFor, normalizeShellDir } from './shell-command.mts'
import { resolveProjectDir } from './project-dir.mts'

export { normalizeShellDir }

export interface GitCwdOptions {
  /**
   * Directory the inspected command starts in. Defaults to the hook cwd.
   */
  readonly cwd?: string | undefined
  /**
   * When set, scope the `-C` lookup to the git invocation carrying one of
   * these subcommands (e.g. `commit`, or `['add', 'commit']` for a guard
   * covering both). Another invocation's `-C` (a `rev-parse` inside a
   * substitution) is NOT borrowed — for a scoped query the fallback is the
   * leading `cd`, then the hook's cwd.
   */
  readonly subcommand?: string | readonly string[] | undefined
}

function dashCValue(args: readonly string[]): string | undefined {
  const idx = args.indexOf('-C')
  return idx === -1 ? undefined : args[idx + 1]
}

/**
 * The directory a `git -C <dir>` inside `command` names, resolved against
 * `cwd`, or undefined when no in-scope invocation carries one. Scoped
 * (`options.subcommand`): only that invocation's own `-C` counts, so a
 * `git -C <elsewhere> rev-parse` in a `$(…)` substitution is not borrowed.
 * Unscoped: the first `-C` on any git invocation.
 *
 * Read this instead of `extractGitCwd` when the caller owns its own fallback —
 * a guard whose no-`-C` answer is the tool call's acted-on path, which follows
 * the LAST `cd` rather than the first.
 */
export function extractGitDashCDir(
  command: string,
  options?: GitCwdOptions | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options } as GitCwdOptions
  const { cwd, subcommand } = opts
  const gitInvocations = commandsFor(command, 'git')
  if (subcommand !== undefined) {
    const wanted = typeof subcommand === 'string' ? [subcommand] : subcommand
    for (const c of gitInvocations) {
      // Match the segment's real SUBCOMMAND, not any arg that spells it — a
      // `git -C commit status` targets a directory named `commit` and must
      // not be read as a `git commit`.
      const sub = gitSubcommand(c.args)
      if (sub !== undefined && wanted.includes(sub)) {
        const dir = dashCValue(c.args)
        return dir ? normalizeShellDir(dir, cwd) : undefined
      }
    }
    return undefined
  }
  for (const c of gitInvocations) {
    const dir = dashCValue(c.args)
    if (dir) {
      return normalizeShellDir(dir, cwd)
    }
  }
  return undefined
}

/**
 * Best-effort working directory for a `git` invocation inside `command`.
 * Scoped (`options.subcommand`): that invocation's own `-C`, else a leading
 * `cd`, else the hook's cwd. Unscoped: the first `-C` on any git invocation,
 * else a leading `cd`, else the hook's cwd. Values are tilde-expanded +
 * resolved — callers hand the result straight to filesystem probes.
 */
export function extractGitCwd(
  command: string,
  options?: GitCwdOptions | undefined,
): string {
  const opts = { __proto__: null, ...options } as GitCwdOptions
  const { cwd } = opts
  const dashCDir = extractGitDashCDir(command, opts)
  if (dashCDir !== undefined) {
    return dashCDir
  }
  const cdDir = commandsFor(command, 'cd')[0]?.args[0]
  if (cdDir) {
    return normalizeShellDir(cdDir, cwd)
  }
  return path.resolve(cwd ?? resolveProjectDir())
}
