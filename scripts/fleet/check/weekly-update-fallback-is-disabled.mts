#!/usr/bin/env node
/**
 * @file `check --all` gate (fail-closed): the non-gh-aw weekly-update fallback
 *   ships ONLY in its disabled form. GitHub Actions loads `*.yml`/`*.yaml` in
 *   `.github/workflows/` and runs anything on a `schedule:` — so the fallback
 *   is shipped as `weekly-update-non-gh-aw.yml.disabled` (the `.disabled`
 *   extension makes it invisible to the Actions loader).
 *   `weekly-update-workflow.mts enable` copies it to the live `.yml` for a
 *   one-off run, then `disable` re-hides it; the enabled `.yml` is meant to be
 *   transient + untracked. If the ENABLED `.yml` is ever committed, it
 *   auto-runs weekly in every repo the file cascades to — an accidental
 *   fleet-wide scheduled workflow with nobody intending it. This check fails
 *   when the enabled form is git-tracked, so the accident can't land. The
 *   `.yml.disabled` form is expected + ignored. Usage: node
 *   scripts/fleet/check/weekly-update-fallback-is-disabled.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync check script; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// The fallback's enabled basename. The shipped form carries a trailing
// `.disabled`; the enabled (auto-running) form does NOT.
const ENABLED_BASENAME = 'weekly-update-non-gh-aw.yml'

// Tracked paths that are the ENABLED fallback (the bare `.yml`, never the
// shipped `.yml.disabled`). Pure: takes the git-tracked path list, returns the
// offenders. Matches on basename so a repo that relocates `.github/` still trips.
export function enabledFallbackTracked(
  trackedPaths: readonly string[],
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = trackedPaths; i < length; i += 1) {
    const p = trackedPaths[i]!
    const base = normalizePath(p).split('/').pop() ?? ''
    if (base === ENABLED_BASENAME) {
      out.push(p)
    }
  }
  return out
}

function trackedFiles(repoRoot: string): string[] {
  const r = spawnSync('git', ['ls-files', '*weekly-update-non-gh-aw.yml*'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return []
  }
  return r.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function main(): number {
  const offenders = enabledFallbackTracked(trackedFiles(REPO_ROOT))
  if (offenders.length) {
    logger.fail(
      '[weekly-update-fallback-is-disabled] the ENABLED weekly-update fallback is git-tracked:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  This `.yml` auto-runs weekly in every repo it cascades to. Only the',
    )
    logger.error(
      '  `.yml.disabled` form ships. Fix: `git rm --cached` the enabled file and',
    )
    logger.error(
      '  run `node scripts/fleet/weekly-update-workflow.mts disable` to re-hide it.',
    )
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[weekly-update-fallback-is-disabled] the weekly-update fallback ships disabled-only.',
    )
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
