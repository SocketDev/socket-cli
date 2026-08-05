/**
 * @file Code-as-law for the fleet's "NO AI attribution" commit rule. Two
 *   fingerprints are asserted absent from the repository. The first is an
 *   AI-attribution trailer in a commit message, meaning a `Co-authored-by:`
 *   naming a vendor agent or a "Generated with …" tag line. The second is an
 *   AI-agent branch prefix — `codex/`, `devin/`, `aider/`, `copilot/`,
 *   `swe-agent/`, `swe-bench/` — on a branch. The rule already exists in
 *   prose. CLAUDE.md requires Conventional Commits, lowercase, with NO AI
 *   attribution. This makes it executable, and it matters past tidiness: both
 *   fingerprints are scored by the public `@unveil/identity` detection engine,
 *   which reads the same trailers and branch prefixes off a repository and
 *   labels the account that pushed them.
 *   THE DEFAULT SCOPE IS WHAT AN OPERATOR CAN ACT ON. It reads the public
 *   default branch (`origin/<default>`, resolved from git and never
 *   hard-coded) and drops every finding at or below the release boundary. A
 *   commit reachable only from some other local ref was never published, and a
 *   commit below the boundary cannot be rewritten without breaking the
 *   provenance of the release built from it — reporting either one is noise
 *   that trains people to ignore the check. Frozen findings are still counted
 *   on one informational line. A local branch carrying an agent prefix is
 *   informational too; only an `origin/` branch fails.
 *   THE BOUNDARY IS RESOLVED OFFLINE, BY ANCESTRY. First a
 *   `release.releaseLine` declaration in `.config/repo/socket-wheelhouse.json`
 *   — `{ "branch": "<ref the customer line lives on>", "boundaryTag":
 *   "<tag>", "tagPattern": "<glob>" }`, all optional. Precedence:
 *   `boundaryTag` names the answer outright and wins; `branch` picks the ref
 *   the ancestry search walks; `tagPattern` (a `git tag --list` glob such as
 *   `v*`) filters the candidate tags before the newest-ancestor pick, for a
 *   repo that also pushes build-asset tags onto the scanned branch. A declared
 *   pattern matching no ancestor tag fails loud rather than widening back to
 *   every tag. Otherwise the newest tag that is an ANCESTOR of the ref being
 *   scanned. Never the newest tag by DATE: a repo can carry several independent
 *   release lines at once, and the newest tag can belong to one that never
 *   ships to customers.
 *   IT FAILS LOUD RATHER THAN GUESS. No git, no repository, no commits, a
 *   shallow clone, a scan that resolves to 0 commits while HEAD exists, a
 *   declared release line git cannot resolve, or findings on a branch that no
 *   tag reaches all exit non-zero. A repository with no tags at all is not an
 *   error — nothing is released, so the whole default branch is the unreleased
 *   tail — and the run says which mode it is in.
 *   Usage: node scripts/fleet/check/commits-have-no-ai-attribution.mts
 *   [--all] [--unpushed] [--verify-registry]
 *   (default)          the public default branch, above the release boundary.
 *   --all              every ref, boundary ignored. The widest audit sweep.
 *   --unpushed         only the commits not yet on the default branch.
 *   --verify-registry  additionally read the published `latest` (npm
 *   dist-tag, or crates.io for a Rust crate) and fail when
 *   it disagrees with the offline boundary. Opt-in: the
 *   default path never touches the network. A member whose
 *   roster `publishes` field names no registry channel has
 *   no `latest` to compare, so the comparison is skipped on
 *   one informational line and the run passes.
 */

import process from 'node:process'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import {
  AttributionScanError,
  gitRunner,
  UnreleasedLineError,
} from './commits-have-no-ai-attribution/commit-history.mts'
import { readReleaseLineDeclaration } from './commits-have-no-ai-attribution/release-boundary.mts'
import {
  isRegistryBoundarySkip,
  verifyBoundaryAgainstRegistry,
} from './commits-have-no-ai-attribution/registry-boundary.mts'
import {
  formatCleanSummary,
  formatFindings,
  formatScopeNotes,
  formatUnreleasedLine,
} from './commits-have-no-ai-attribution/report.mts'
import { scanForAiAttribution } from './commits-have-no-ai-attribution/scan.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'
import type { GitRunner } from './commits-have-no-ai-attribution/commit-history.mts'
import type { ReleaseLineDeclaration } from './commits-have-no-ai-attribution/release-boundary.mts'
import type { AttributionScan } from './commits-have-no-ai-attribution/scan.mts'

const logger = getDefaultLogger()

export interface RunCheckOptions {
  readonly all?: boolean | undefined
  readonly git?: GitRunner | undefined
  readonly releaseLine?: ReleaseLineDeclaration | undefined
  readonly unpushed?: boolean | undefined
  readonly verifyRegistry?: boolean | undefined
}

/**
 * Compare the offline boundary against the published `latest`. Returns 1 when
 * they disagree, because a boundary that does not match what customers install
 * is freezing the wrong span of history.
 */
export async function reportRegistryAgreement(
  repoRoot: string,
  scan: AttributionScan,
): Promise<number> {
  if (!scan.boundary) {
    logger.info(
      '[commits-have-no-ai-attribution] --verify-registry: this scope resolves no boundary, so there is nothing to verify.',
    )
    return 0
  }
  const verdict = await verifyBoundaryAgainstRegistry(repoRoot, scan.boundary)
  if (!verdict) {
    logger.info(
      '[commits-have-no-ai-attribution] --verify-registry: this repo publishes no npm package or crate, so there is nothing to verify.',
    )
    return 0
  }
  if (isRegistryBoundarySkip(verdict)) {
    logger.info(
      `[commits-have-no-ai-attribution] registry check skipped: ${verdict.reason}.`,
    )
    return 0
  }
  if (verdict.agrees) {
    logger.info(
      `[commits-have-no-ai-attribution] --verify-registry: ${verdict.detail}.`,
    )
    return 0
  }
  logger.fail(
    [
      '[commits-have-no-ai-attribution] the offline release boundary disagrees with the registry.',
      '',
      '  What:   the boundary this check froze history at is not the release',
      '          customers actually install.',
      `  Where:  ${repoRoot} — ${verdict.registry} package ${verdict.packageName}`,
      `  Saw:    ${verdict.detail}.`,
      '  Wanted: the offline boundary and the published `latest` to name the',
      '          same release.',
      '  Fix:    Declare the real line in .config/repo/socket-wheelhouse.json',
      '          under `release.releaseLine` (`branch` for the ref the customer',
      '          line lives on, `boundaryTag` for the tag itself), or push the',
      '          missing release tag so ancestry can find it.',
      '',
    ].join('\n'),
  )
  return 1
}

export async function runCheck(
  repoRoot: string,
  options?: RunCheckOptions | undefined,
): Promise<number> {
  const opts = { __proto__: null, ...options } as RunCheckOptions
  const git = opts.git ?? gitRunner(repoRoot)
  const releaseLine =
    opts.releaseLine ?? readReleaseLineDeclaration(repoRoot) ?? undefined
  let scan: AttributionScan
  try {
    scan = await scanForAiAttribution(git, {
      all: opts.all,
      ...(releaseLine ? { releaseLine } : {}),
      unpushed: opts.unpushed,
    })
  } catch (e) {
    if (e instanceof UnreleasedLineError) {
      logger.fail(formatUnreleasedLine(e, repoRoot))
      return 1
    }
    const reason = e instanceof AttributionScanError ? e.message : String(e)
    logger.fail(
      [
        '[commits-have-no-ai-attribution] cannot verify the AI-attribution rule.',
        '',
        '  What:   the scan could not read the repository.',
        `  Where:  ${repoRoot}`,
        `  Saw:    ${reason}.`,
        '  Fix:    resolve the condition above, then re-run. Reporting a pass',
        '          here would be a false green.',
        '',
      ].join('\n'),
    )
    return 1
  }
  for (const note of formatScopeNotes(scan)) {
    logger.info(note)
  }
  if (scan.commits.length || scan.branches.length) {
    logger.fail(formatFindings(scan))
    return 1
  }
  logger.info(formatCleanSummary(scan))
  return opts.verifyRegistry ? await reportRegistryAgreement(repoRoot, scan) : 0
}

export async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      all: { type: 'boolean' },
      unpushed: { type: 'boolean' },
      'verify-registry': { type: 'boolean' },
    },
    strict: false,
  })
  return await runCheck(REPO_ROOT, {
    all: !!values['all'],
    unpushed: !!values['unpushed'],
    verifyRegistry: !!values['verify-registry'],
  })
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks commits and branches for AI-attribution trailers and agent branch prefixes',
  help: `Usage: node scripts/fleet/check/commits-have-no-ai-attribution.mts [flags]

  --all              scan every ref, ignoring the release boundary
  --unpushed         scan only commits not yet on the default branch
  --verify-registry  also verify the boundary against the published latest release`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
