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

import process from 'node:process'

import { commandsFor, normalizeShellDir } from './shell-command.mts'

export { normalizeShellDir }

export interface GitCwdOptions {
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
  const { subcommand } = opts
  const gitInvocations = commandsFor(command, 'git')
  if (subcommand !== undefined) {
    const wanted = typeof subcommand === 'string' ? [subcommand] : subcommand
    for (const c of gitInvocations) {
      if (wanted.some(s => c.args.includes(s))) {
        const dir = dashCValue(c.args)
        if (dir) {
          return normalizeShellDir(dir)
        }
        break
      }
    }
  } else {
    for (const c of gitInvocations) {
      const dir = dashCValue(c.args)
      if (dir) {
        return normalizeShellDir(dir)
      }
    }
  }
  const cdDir = commandsFor(command, 'cd')[0]?.args[0]
  if (cdDir) {
    return normalizeShellDir(cdDir)
  }
  return process.cwd()
}
