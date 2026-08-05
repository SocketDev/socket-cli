#!/usr/bin/env node
/*
 * @file `check --all` gate: the thin-distribution untrack set NEVER contains a
 *   CI-critical GitHub path. A thin member `git rm --cached`s every path
 *   `thinIgnoreEntries` returns; GitHub reads `.github/workflows/**` (a
 *   workflow's trigger/cron) and `.github/actions/fleet/**` (a
 *   `uses: ./.github/actions/...` composite) from the committed default-branch
 *   tree BEFORE any fetch step could repopulate them — so untracking one breaks
 *   the member's CI outright. The carve-out lives in `isAlwaysTrackedGitHubSurface`
 *   (scripts/fleet/_shared/github-tracked-surface.mts), consumed by the dep-0
 *   `thinIgnoreEntries`; this check proves the SHIPPED fetcher
 *   (scripts/repo/bootstrap/fleet.mjs) honors it.
 *
 *   The proof feeds `thinIgnoreEntries` a synthetic release manifest whose files
 *   map contains the real CI surface (the repo's tracked `.github/workflows` +
 *   `.github/actions/fleet` files, plus canonical examples so the assertion
 *   fires even in a repo with a sparse CI tree) alongside a wholly-fleet control
 *   path. It then asserts (a) NO returned entry is a CI path and (b) the control
 *   path IS returned — (b) guards against a broken import or an empty result
 *   false-greening (a).
 *
 *   Runs per-tree (wheelhouse + every member). Vacuous pass where the built
 *   fetcher is absent, a partially-onboarded repo. Exit: 0 — clean / no
 *   fetcher; 1 — a CI path is in the untrack set, or the control path is not.
 *
 *   Usage: node scripts/fleet/check/thin-untrack-set-is-ci-safe.mts [--quiet]
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import {
  ALWAYS_TRACKED_GITHUB_PREFIXES,
  isAlwaysTrackedGitHubSurface,
} from '../_shared/github-tracked-surface.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The shipped dep-0 fetcher whose thinIgnoreEntries computes the untrack set.
const FLEET_FETCHER_REL = 'scripts/repo/bootstrap/fleet.mjs'

// Canonical CI paths always injected so the exclusion is exercised even in a
// repo whose tracked CI tree is sparse, a fresh member.
const CANONICAL_CI_PATHS: readonly string[] = [
  '.github/actions/fleet/setup/action.yml',
  '.github/workflows/ci.yml',
]

// A wholly-fleet, non-hybrid, non-splice, non-CI bundle path — the positive
// control thinIgnoreEntries MUST return, proving the function ran and the
// result isn't vacuously empty.
const CONTROL_FLEET_PATH = 'scripts/fleet/check/thin-untrack-set-is-ci-safe.mts'

/**
 * The repo's tracked CI surface: every `.github/workflows` +
 * `.github/actions/fleet` path git tracks, normalized to `/`. Empty when git is
 * unavailable — the canonical paths still exercise the exclusion.
 */
export async function trackedCiPaths(cwd: string): Promise<string[]> {
  try {
    const result = await spawn(
      'git',
      ['ls-files', '--', '.github/workflows', '.github/actions/fleet'],
      { cwd, stdioString: true },
    )
    return String(result.stdout ?? '')
      .split('\n')
      .filter(Boolean)
      .map(normalizePath)
  } catch {
    return []
  }
}

/**
 * The CI paths that leaked into `untrack` — the violation set. Pure; exported
 * for tests.
 */
export function ciPathsInUntrackSet(untrack: readonly string[]): string[] {
  return untrack.filter(isAlwaysTrackedGitHubSurface)
}

export async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const fetcherPath = path.join(REPO_ROOT, FLEET_FETCHER_REL)
  if (!existsSync(fetcherPath)) {
    if (!quiet) {
      logger.log(
        `thin-untrack-set-is-ci-safe: no ${FLEET_FETCHER_REL} — vacuous pass.`,
      )
    }
    process.exitCode = 0
    return
  }

  const { thinIgnoreEntries } = (await import(
    pathToFileURL(fetcherPath).href
  )) as {
    thinIgnoreEntries: (manifest: { files: Record<string, string> }) => string[]
  }

  const ciPaths = [
    ...new Set([...CANONICAL_CI_PATHS, ...(await trackedCiPaths(REPO_ROOT))]),
  ]
  const files: Record<string, string> = { [CONTROL_FLEET_PATH]: 'x' }
  for (let i = 0, { length } = ciPaths; i < length; i += 1) {
    files[ciPaths[i]!] = 'x'
  }

  const untrack = thinIgnoreEntries({ files })
  const offenders = ciPathsInUntrackSet(untrack)
  const controlPresent = untrack.includes(CONTROL_FLEET_PATH)

  if (offenders.length === 0 && controlPresent) {
    if (!quiet) {
      logger.log(
        `thin-untrack-set-is-ci-safe: ${ciPaths.length} CI path(s) stay tracked; untrack set is CI-safe.`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!controlPresent) {
    logger.fail(
      'thin-untrack-set-is-ci-safe: the control path did not appear in the untrack set — the check could not verify exclusion.',
    )
    logger.fail(
      '  What:  thinIgnoreEntries returned an unexpected result (empty or\n' +
        '         missing the wholly-fleet control path) — a broken import or a\n' +
        '         regressed function would false-green the CI assertion below.\n' +
        `  Where: ${FLEET_FETCHER_REL} (thinIgnoreEntries).\n` +
        `  Wanted: ${CONTROL_FLEET_PATH} in the untrack set.\n` +
        '  Fix:   regenerate the fetcher (node scripts/repo/gen/bootstrap.mts) and\n' +
        '         confirm thinIgnoreEntries is exported + intact.',
    )
    process.exitCode = 1
    return
  }

  logger.fail(
    `thin-untrack-set-is-ci-safe: ${offenders.length} CI path(s) are in the thin untrack set:`,
  )
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    logger.fail(`  ${offenders[i]!}`)
  }
  logger.fail(
    '  What:  a CI-critical GitHub path is in the thin untrack set. A thin\n' +
      '         member git-untracks these, but GitHub reads them from the\n' +
      '         committed tree BEFORE any fetch runs — untracking one breaks CI.\n' +
      `  Where: ${FLEET_FETCHER_REL} (thinIgnoreEntries).\n` +
      `  Wanted: no path under ${ALWAYS_TRACKED_GITHUB_PREFIXES.join(' or ')} in the set.\n` +
      '  Fix:   thinIgnoreEntries must skip isAlwaysTrackedGitHubSurface(p)\n' +
      '         (scripts/repo/gen/bootstrap/src/install.mts); add the prefix to\n' +
      '         template/base/scripts/fleet/_shared/github-tracked-surface.mts,\n' +
      '         then regenerate: node scripts/repo/gen/bootstrap.mts.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the thin-distribution untrack set never removes a CI-critical GitHub path',
  help: `Usage: node scripts/fleet/check/thin-untrack-set-is-ci-safe.mts [flags]
  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
