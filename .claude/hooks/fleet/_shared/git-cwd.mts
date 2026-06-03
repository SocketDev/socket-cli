/**
 * @file Resolve the directory a `git` command in a Bash string would run in.
 *   Shared by the fleet-push / fleet-PR guards, which both need to know which
 *   repo a `git push` (or a `cd <dir> && git ...`) targets before deciding
 *   whether the destination is a fleet repo. Regex-based on purpose: we only
 *   need the `-C` / leading-`cd` directory, not full command structure (the
 *   command DETECTION that needs structure goes through the shell parser).
 */

import path from 'node:path'
import process from 'node:process'

// `git -C <dir> ...` — explicit working directory. We only need the VALUE.
export const GIT_DASH_C_RE = /\bgit\s+-C\s+("([^"]+)"|'([^']+)'|(\S+))/

// A leading `cd <dir>` before the git command, e.g. `cd /x/depot && git push`.
// Only the FIRST cd in the chain matters for where git runs.
export const LEADING_CD_RE = /(?:^|[;&|]|&&)\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))/

/**
 * Best-effort working directory for a `git` invocation inside `command`: `git
 * -C <dir>` wins, then a leading `cd <dir>` (resolved against the hook's own
 * cwd so a relative `cd ../foo` works), else the hook's cwd.
 */
export function extractGitCwd(command: string): string {
  // Priority 1: explicit `git -C <dir>`.
  const dashC = GIT_DASH_C_RE.exec(command)
  if (dashC) {
    return dashC[2] ?? dashC[3] ?? dashC[4] ?? process.cwd()
  }
  // Priority 2: a leading `cd <dir>` in the chain.
  const cd = LEADING_CD_RE.exec(command)
  if (cd) {
    const dir = cd[2] ?? cd[3] ?? cd[4]
    if (dir) {
      return path.resolve(process.cwd(), dir)
    }
  }
  // Priority 3: the hook's own cwd.
  return process.cwd()
}
