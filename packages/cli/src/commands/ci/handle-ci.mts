import { env } from 'node:process'

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { envAsString } from '@socketsecurity/lib-stable/env/string'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import { REPORT_LEVEL_ERROR } from '../../constants/reporting.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../util/git/operations.mjs'
import { serializeResultJson } from '../../util/output/result-json.mjs'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

const logger = getDefaultLogger()

/**
 * Derive the pull request number from CI environment. GitHub Actions
 * pull_request events check out `refs/pull/<n>/merge`, so the number is
 * recoverable from GITHUB_REF; returns 0 outside a PR run (the API omits
 * `pull_request` for falsy values).
 */
export function detectCiPullRequestNumber(): number {
  const match = /^refs\/pull\/(\d+)\//.exec(envAsString(env['GITHUB_REF']))
  return match ? Number(match[1]) : 0
}

export async function handleCi(autoManifest: boolean): Promise<void> {
  debug('Starting CI scan')
  debugDir({ autoManifest })

  const orgSlugCResult = await getDefaultOrgSlug()
  if (!orgSlugCResult.ok) {
    debug('Failed to get default org slug')
    debugDir({ orgSlugCResult })
    process.exitCode = orgSlugCResult.code ?? 1
    // Always assume json mode.
    logger.log(serializeResultJson(orgSlugCResult))
    return
  }

  const orgSlug = orgSlugCResult.data
  const cwd = process.cwd()
  const branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
  const repoName = await getRepoName(cwd)

  debug(`CI scan for ${orgSlug}/${repoName} on branch ${branchName}`)
  debugDir({ orgSlug, cwd, branchName, repoName })

  await handleCreateNewScan({
    autoManifest,
    basics: false,
    branchName,
    commitMessage: '',
    commitHash: '',
    committers: '',
    cwd,
    defaultBranch: false,
    interactive: false,
    orgSlug,
    outputKind: 'json',
    // When 'pendingHead' is true, it requires 'branchName' set and 'tmp' false.
    pendingHead: true,
    pullRequest: detectCiPullRequestNumber(),
    reach: {
      excludePaths: [],
      reachAnalysisMemoryLimit: 0,
      reachAnalysisTimeout: 0,
      reachConcurrency: 1,
      reachDebug: false,
      reachDetailedAnalysisLogFile: false,
      reachDisableAnalytics: false,
      reachDisableExternalToolChecks: false,
      reachEnableAnalysisSplitting: false,
      reachEcosystems: [],
      reachExcludePaths: [],
      reachLazyMode: false,
      reachMinSeverity: '',
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachUseUnreachableFromPrecomputation: false,
      reachVersion: undefined,
      runReachabilityAnalysis: false,
    },
    repoName,
    readOnly: false,
    report: true,
    reportLevel: REPORT_LEVEL_ERROR,
    targets: ['.'],
    // Don't set 'tmp' when 'pendingHead' is true.
    tmp: false,
  })
}
