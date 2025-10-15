import { debug, debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import constants from '../../constants.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git/git.mjs'
import { serializeResultJson } from '../../utils/output/result-json.mjs'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

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
      reachAnalysisTimeout: 0,
      reachAnalysisMemoryLimit: 0,
      reachDisableAnalytics: false,
      reachEcosystems: [],
      reachExcludePaths: [],
      reachSkipCache: false,
      runReachabilityAnalysis: false,
    },
    repoName,
    readOnly: false,
    report: true,
    reportLevel: constants.REPORT_LEVEL_ERROR,
    targets: ['.'],
    // Don't set 'tmp' when 'pendingHead' is true.
    tmp: false,
  })
}
