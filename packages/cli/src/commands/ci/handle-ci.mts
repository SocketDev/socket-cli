import { debug, debugDir } from '@socketsecurity/lib/debug'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import { REPORT_LEVEL_ERROR } from '../../constants/reporting.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git/operations.mjs'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

const logger = getDefaultLogger()

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
    pullRequest: 0,
    reach: {
      reachAnalysisMemoryLimit: 0,
      reachAnalysisTimeout: 0,
      reachConcurrency: 1,
      reachDebug: false,
      reachDisableAnalytics: false,
      reachDisableAnalysisSplitting: false,
      reachEcosystems: [],
      reachExcludePaths: [],
      reachMinSeverity: '',
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachUseUnreachableFromPrecomputation: false,
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
