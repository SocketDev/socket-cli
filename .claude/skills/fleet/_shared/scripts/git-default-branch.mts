/**
 * Default-branch resolution for fleet skill runners.
 *
 * Per CLAUDE.md "Default branch fallback" rule: prefer main, fall back to
 * master. Never hard-code one or the other — fleet repos are mostly on main,
 * but a few legacy / vendored repos still use master, and a script that
 * hard-codes main silently no-ops on those.
 *
 * Cross-platform: shells out to git via @socketsecurity/lib/spawn, which works
 * the same on macOS / Linux / Windows.
 *
 * Also runnable as a one-line CLI so skill docs don't re-implement the fallback
 * chain in shell: `BASE=$(node .../git-default-branch.mts)`. Pass a repo path
 * as the first arg to resolve in a different working directory.
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { errorMessage } from '@socketsecurity/lib/errors'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'
import { isSpawnError } from '@socketsecurity/lib/process/spawn/errors'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

export type ResolveDefaultBranchOptions = {
  /**
   * Working directory; defaults to process.cwd().
   */
  readonly cwd?: string | undefined
  /**
   * Remote name; defaults to 'origin'.
   */
  readonly remote?: string | undefined
}

/**
 * Resolve the remote's default branch, preferring `main` and falling back to
 * `master`. Returns `'main'` as a final fallback when the remote has neither
 * branch (e.g., fresh clone before `git fetch`).
 *
 * Resolution order:
 *
 * 1. `git symbolic-ref refs/remotes/<remote>/HEAD` — most reliable.
 * 2. Probe `refs/remotes/<remote>/main` — true on the vast majority of fleet
 *    repos.
 * 3. Probe `refs/remotes/<remote>/master` — legacy / vendored repos.
 * 4. Assume `main` and let the next git command fail loudly.
 */
export async function resolveDefaultBranch(
  options: ResolveDefaultBranchOptions = {},
): Promise<string> {
  const { cwd = process.cwd(), remote = 'origin' } = options

  // Step 1: ask the remote what its HEAD points to.
  try {
    const ref = await runGit(
      ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
      cwd,
    )
    if (ref) {
      // Strip the "<remote>/" prefix.
      return ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref
    }
  } catch {
    // Fall through.
  }

  // Step 2 + 3: probe main, then master.
  for (const branch of ['main', 'master']) {
    if (await branchExists(branch, cwd, remote)) {
      return branch
    }
  }

  // Step 4: last resort.
  return 'main'
}

async function branchExists(
  branch: string,
  cwd: string,
  remote: string,
): Promise<boolean> {
  try {
    await runGit(
      ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${branch}`],
      cwd,
    )
    return true
  } catch {
    return false
  }
}

async function runGit(args: readonly string[], cwd: string): Promise<string> {
  try {
    const result = await spawn('git', args, { cwd, stdioString: true })
    return String(result.stdout ?? '').trim()
  } catch (e) {
    if (isSpawnError(e)) {
      throw e
    }
    throw e
  }
}

async function main(): Promise<void> {
  const logger = getDefaultLogger()
  const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
  try {
    logger.log(await resolveDefaultBranch({ cwd }))
  } catch (e) {
    logger.error(errorMessage(e))
    process.exitCode = 1
  }
}

// Run as a CLI only when invoked directly, not when imported by a sibling
// runner (reorder-bump.mts, squashing-history/run.mts, updating/lib/discover.mts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main()
}
