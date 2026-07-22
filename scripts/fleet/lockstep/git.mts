/**
 * @file Git helpers for the lockstep harness. Thin wrappers over `git -C <dir>
 *   <cmd>` that the kind checkers (file-fork, version-pin) use to peek at
 *   submodule state without dragging in a full libgit binding. The harness is
 *   read-only over the working tree — the ONE mutation is `fetchTagsQuiet`, a
 *   best-effort `git fetch --tags` the version-pin drift path runs so a
 *   never-fetched shallow/partial clone can't under-report drift off a stale
 *   remote ref; it touches only remote-tracking refs + tags, never HEAD or the
 *   checkout. `isShallowRepo` is the belt behind it: when a fetch can't deepen
 *   a shallow clone, the drift count is untrustworthy and the checker says so
 *   LOUD instead of reporting a falsely-low number. `splitLines` is the
 *   CRLF-tolerant counterpart to `.split('\n')`; bare splits leave a trailing
 *   `\r` on each line when git is invoked on Windows / msys, which throws off
 *   downstream `includes`/match checks. `resolveUpstream` is a lookup helper
 *   that lives here because it's coupled to the same per-row-message
 *   accumulator the other helpers write to.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import type { Upstream } from './schema.mts'
import type { DriftCommit, Manifest } from './types.mts'

/**
 * Split text on LF after CRLF normalization. Git on Windows / msys may emit
 * CRLF-terminated output; bare `.split('\n')` leaves a trailing `\r` on every
 * line that throws off downstream `includes`/match checks.
 */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

export function gitIn(submoduleDir: string, args: string[]): string {
  const result = spawnSync('git', ['-C', submoduleDir, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (status ${result.status}): ${String(result.stderr).trim()}`,
    )
  }
  return String(result.stdout)
}

export function shaIsReachable(submoduleDir: string, sha: string): boolean {
  try {
    gitIn(submoduleDir, ['cat-file', '-e', sha])
    return true
  } catch {
    return false
  }
}

/**
 * Best-effort `git fetch --tags` so drift is computed against the CURRENT
 * upstream default ref + release tags, not a stale remote-tracking ref left by
 * a shallow/partial clone that was never re-fetched. Returns true when the
 * fetch succeeded. Failure — offline, no remote, auth — is swallowed: the
 * caller falls back to `isShallowRepo` / no-ref detection and reports drift as
 * unknown rather than trusting an unrefreshed count. Timeout-bounded so a slow
 * remote can't wedge `pnpm run lockstep`. Touches only remote-tracking refs +
 * tags.
 */
export function fetchTagsQuiet(submoduleDir: string): boolean {
  try {
    const result = spawnSync(
      'git',
      ['-C', submoduleDir, 'fetch', '--tags', '--quiet'],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        stdioString: true,
        timeout: 30_000,
      },
    )
    return !result.error && result.status === 0
  } catch {
    return false
  }
}

/**
 * True when the submodule is a shallow clone (`git rev-parse
 * --is-shallow-repository`). A shallow clone can't yield a trustworthy
 * `pinned_sha..origin` count — `rev-list` truncates at the graft boundary — so
 * the version-pin checker surfaces drift as UNKNOWN rather than a falsely-low
 * number. Fails closed to non-shallow when git can't answer, matching the
 * repo's other read helpers.
 */
export function isShallowRepo(submoduleDir: string): boolean {
  try {
    return (
      gitIn(submoduleDir, ['rev-parse', '--is-shallow-repository']).trim() ===
      'true'
    )
  } catch {
    return false
  }
}

export function driftCommitsSince(
  submoduleDir: string,
  sha: string,
  pathInRepo: string,
): DriftCommit[] {
  try {
    const out = gitIn(submoduleDir, [
      'log',
      '--pretty=format:%H%x09%s',
      `${sha}..HEAD`,
      '--',
      pathInRepo,
    ])
    const trimmed = out.trim()
    if (!trimmed) {
      return []
    }
    return splitLines(trimmed).map(line => {
      // Preserve any embedded tabs in the commit subject (rare but
      // possible) — `.split` destructuring would truncate at the
      // first tab inside the summary.
      const [commitSha, ...summaryParts] = line.split('\t')
      return {
        sha: commitSha ?? '',
        summary: summaryParts.join('\t') ?? '',
      }
    })
  } catch {
    return []
  }
}

export function resolveUpstream(
  manifest: Manifest,
  alias: string,
  messages: string[],
): Upstream | undefined {
  const upstream = manifest.upstreams?.[alias]
  if (!upstream) {
    const known = Object.keys(manifest.upstreams ?? {}).join(', ') || '(none)'
    messages.push(`unknown upstream alias '${alias}' (known: ${known})`)
    return undefined
  }
  return upstream
}
