/**
 * @file Gap engine — Brewfile drift. Pure functions, no FS reads, no spawn. A
 *   repo is "enrolled" in the pinned-bundle brew flow when it has a repo-root
 *   Brewfile (the enrollment signal `check/brew-install-is-pinned.mts` also
 *   gates on); an unenrolled repo produces no finding, since enrollment is a
 *   deliberate, separate step. An enrolled repo's Brewfile can drift from its
 *   real `.github/` brew install sites (a `brew install` line added without
 *   regenerating the manifest, or the soak window bumped) — that drift is what
 *   makes `brew-install-is-pinned.mts` red. `findBrewfileDrift` decides drift
 *   by comparing the committed Brewfile text against a fresh `renderBrewfile()`
 *   over the caller-supplied discovered tools; `formatBrewfileDriftFinding`
 *   renders the DoctorFinding. The doctor.mts caller owns the FS reads
 *   (`findManifestBrewSites`, reading the Brewfile) and the `--fix` write.
 */

import { renderBrewfile } from '../../update/brew-parse.mts'

import type { DoctorFinding } from './catalog-gap.mts'
import type { BrewTool } from '../../update/brew-parse.mts'

export interface BrewfileDriftResult {
  // True when `brewfileContent` differs from a fresh render of `discoveredTools`.
  // Always false when the repo is not enrolled.
  drifted: boolean
  // True when a repo-root Brewfile is present (the enrollment signal).
  enrolled: boolean
  // The freshly-rendered Brewfile text — what --fix writes when drifted.
  expected: string
}

/**
 * Decide whether an enrolled repo's Brewfile has drifted from a fresh render
 * of its discovered `.github/` brew install sites. `brewfileContent` is
 * `undefined` when the repo has no repo-root Brewfile (not enrolled) — the
 * result reports `enrolled: false` and never `drifted: true` in that case.
 */
export function findBrewfileDrift(options: {
  brewfileContent: string | undefined
  discoveredTools: readonly BrewTool[]
  soakDays: number
}): BrewfileDriftResult {
  const opts = Object.assign(Object.create(null), options) as typeof options
  const expected = renderBrewfile(opts.discoveredTools, opts.soakDays)
  if (opts.brewfileContent === undefined) {
    return { drifted: false, enrolled: false, expected }
  }
  return {
    drifted: opts.brewfileContent !== expected,
    enrolled: true,
    expected,
  }
}

/**
 * Format a fixable DoctorFinding for a drifted Brewfile. `--fix` rewrites the
 * file to `expected`; report-only mode surfaces this loud so
 * `check/brew-install-is-pinned.mts` never reds without an actionable finding
 * pointing at the exact regeneration command.
 */
export function formatBrewfileDriftFinding(options: {
  brewfilePath: string
  expected: string
  soakDays: number
}): DoctorFinding {
  const opts = Object.assign(Object.create(null), options) as typeof options
  return {
    fix: [
      'Regenerate the Brewfile (run node scripts/fleet/doctor.mts --fix to',
      'apply automatically), or directly via the brew updater:',
      '',
      `  node scripts/fleet/update/brew.mts --write-manifest --soak-days ${opts.soakDays}`,
    ].join('\n'),
    fixable: true,
    saw: 'Brewfile content does not byte-match renderBrewfile() over the current .github/ brew install sites',
    wanted:
      'Brewfile byte-matches a fresh renderBrewfile(<current .github brew install sites>, SOAK_DAYS)',
    what: 'Brewfile drifted from its .github brew install sites',
    where: opts.brewfilePath,
  }
}
