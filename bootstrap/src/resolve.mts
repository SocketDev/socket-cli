/**
 * @file GitHub release resolution and lock-step assertion helpers.
 *   Extracted from fleet.mts to keep that file under the 500-line soft cap.
 *   All functions here shell out to `gh` (dep-0: no socket-lib) or are pure
 *   logic; none do filesystem writes.
 *   Lock-step note: assertLockStep enforces the cascadeSha === templateSha
 *   invariant but does not resolve refs itself — see resolveReleaseTemplateSha.
 */

// oxlint-disable-next-line socket/prefer-spawn-over-execsync -- dep-0 bare-node fetcher (documented invariant: never imports in-repo socket-lib): gh resolution runs via node:child_process
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { formatLockStepError } from './lockstep.mts'

const logger = getDefaultLogger()

// The manifest filename — same constant as fleet.mts (dep-0: no shared module
// for this one constant; it's trivial to keep in sync).
const MANIFEST_NAME = 'release-bundle-manifest.json'

/**
 * Assert the lock-step invariant before applying a release: the member's pinned
 * `bundle.cascadeSha` MUST equal the release's `templateSha`.
 * `--frozen-lockfile` semantics — a hard fail (never apply a mismatched
 * release). Returns true when intact OR when the member declares no
 * `cascadeSha` (a non-lock-step member — the legacy ref-only pin still
 * fetches). Logs the parsed error + returns false on mismatch.
 */
export function assertLockStep(options: {
  readonly cascadeSha: string | undefined
  readonly manifestTemplateSha: string
  readonly ref: string
}): boolean {
  const { cascadeSha, manifestTemplateSha, ref } = {
    __proto__: null,
    ...options,
  } as typeof options
  // A member that hasn't adopted the lock-step pin (no cascadeSha) keeps the
  // legacy ref-only fetch — the invariant only binds once both halves exist.
  if (cascadeSha === undefined) {
    return true
  }
  if (cascadeSha === manifestTemplateSha) {
    return true
  }
  logger.error(
    formatLockStepError({
      cascadeSha,
      pinnedTemplateSha: manifestTemplateSha,
      ref,
    }),
  )
  return false
}

/**
 * Resolve the NEWEST `fleet-*` release tag via `gh release list`. Returns the
 * latest tag, or undefined when none / offline. The list is newest-first.
 */
export function resolveNewestRef(repo: string): string | undefined {
  try {
    const out = execFileSync(
      'gh',
      [
        'release',
        'list',
        '--repo',
        repo,
        '--limit',
        '30',
        '--json',
        'tagName,createdAt',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const rows = JSON.parse(out) as Array<{
      tagName?: unknown | undefined
      createdAt?: unknown | undefined
    }>
    for (const row of rows) {
      if (typeof row.tagName === 'string' && row.tagName.startsWith('fleet-')) {
        return row.tagName
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve a release's `templateSha` from its manifest asset via gh. Dep-0:
 * shells `gh release download <ref> --pattern release-bundle-manifest.json` and
 * reads the stamped field. Returns undefined when the release / asset / field
 * is absent (offline, no such tag) — the caller decides whether that's fatal.
 */
export function resolveReleaseTemplateSha(
  ref: string,
  repo: string,
): string | undefined {
  if (!ref) {
    return undefined
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'))
  try {
    execFileSync(
      'gh',
      [
        'release',
        'download',
        ref,
        '--repo',
        repo,
        '--pattern',
        MANIFEST_NAME,
        '--dir',
        tmp,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    )
    const manifestPath = path.join(tmp, MANIFEST_NAME)
    if (!existsSync(manifestPath)) {
      return undefined
    }
    const json = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      templateSha?: unknown | undefined
    }
    return typeof json.templateSha === 'string' ? json.templateSha : undefined
  } catch {
    return undefined
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
