import { logger } from '@socketsecurity/registry/lib/logger'

import { getDefaultOrgSlug } from './fetch-default-org-slug.mts'
import {
  detectDefaultBranch,
  getRepoName,
  gitBranch,
} from '../../utils/git.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'
import { handleCreateNewScan } from '../scan/handle-create-new-scan.mts'

export async function handleCi(autoManifest: boolean): Promise<void> {
  const orgSlugCResult = await getDefaultOrgSlug()
  if (!orgSlugCResult.ok) {
    process.exitCode = orgSlugCResult.code ?? 1
    // Always assume json mode.
    logger.log(serializeResultJson(orgSlugCResult))
    return
  }

  const orgSlug = orgSlugCResult.data
  const cwd = process.cwd()
  const branchName = (await gitBranch(cwd)) || (await detectDefaultBranch(cwd))
  const repoName = await getRepoName(cwd)

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
      runReachabilityAnalysis: false,
    },
    repoName,
    readOnly: false,
    report: true,
    targets: ['.'],
    // Don't set 'tmp' when 'pendingHead' is true.
    tmp: false,
  })
}
