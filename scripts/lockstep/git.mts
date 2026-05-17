/**
 * @fileoverview Git helpers for the lockstep harness.
 *
 * Thin wrappers over `git -C <dir> <cmd>` that the kind checkers (file-fork,
 * version-pin) use to peek at submodule state without dragging in a full
 * libgit binding. The harness is read-only — these helpers never mutate.
 *
 * `splitLines` is the CRLF-tolerant counterpart to `.split('\n')`; bare
 * splits leave a trailing `\r` on each line when git is invoked on
 * Windows / msys, which throws off downstream `includes`/match checks.
 *
 * `resolveUpstream` is a lookup helper that lives here because it's
 * coupled to the same per-row-message accumulator the other helpers
 * write to.
 */

import { spawnSync } from '@socketsecurity/lib/spawn'

import type { Upstream } from './schema.mts'
import type { DriftCommit, Manifest } from './types.mts'

/**
 * Split text on LF after CRLF normalization. Git on Windows / msys may
 * emit CRLF-terminated output; bare `.split('\n')` leaves a trailing
 * `\r` on every line that throws off downstream `includes`/match checks.
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
