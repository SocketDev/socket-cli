import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { REPORT_LEVEL_ERROR } from '../../constants/reporting.mjs'
import {
  GITHUB_ERR_ABUSE_DETECTION,
  GITHUB_ERR_AUTH_FAILED,
  GITHUB_ERR_GRAPHQL_RATE_LIMIT,
  GITHUB_ERR_RATE_LIMIT,
} from '../../util/git/github.mts'
import { fetchListAllRepos } from '../repository/fetch-list-all-repos.mts'
import { testAndDownloadManifestFiles } from './github-scan-manifest.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk-stable'
const logger = getDefaultLogger()

export type RepoListItem =
  SocketSdkSuccessResult<'listRepositories'>['data']['results'][number]

export async function createScanFromGithub({
  all,
  githubApiUrl,
  githubToken,
  interactive,
  orgGithub,
  orgSlug,
  outputKind,
  repos,
}: {
  all: boolean
  githubApiUrl: string
  githubToken: string
  interactive: boolean
  orgSlug: string
  orgGithub: string
  outputKind: OutputKind
  repos: string
}): Promise<CResult<undefined>> {
  let targetRepos: string[] = repos
    .trim()
    .split(',')
    .map(r => r.trim())
    .filter(Boolean)
  if (all || !targetRepos.length) {
    // Fetch from Socket API
    const result = await fetchListAllRepos(orgSlug, {
      direction: 'asc',
      sort: 'name',
    })
    if (!result.ok) {
      return result
    }
    targetRepos = result.data.results.map((obj: RepoListItem) => obj.slug || '')
  }

  targetRepos = targetRepos.map(s => s.trim()).filter(Boolean)

  logger.info(`Have ${targetRepos.length} repo names to Scan!`)
  logger.log('')

  if (!targetRepos.length) {
    return {
      ok: false,
      message: 'No repo found',
      cause:
        'You did not set the --repos value and/or the server responded with zero repos when asked for some. Unable to proceed.',
    }
  }

  // Non-interactive or explicitly requested; just do it.
  if (interactive && targetRepos.length > 1 && !all && !repos) {
    const result = await selectFocus(targetRepos)
    if (!result.ok) {
      return result
    }
    targetRepos = result.data
  }

  // 10 is an arbitrary number. Maybe confirm whenever count>1 ?
  // Do not ask to confirm when the list was given explicit.
  if (interactive && (all || !repos) && targetRepos.length > 10) {
    const sure = await makeSure(targetRepos.length)
    if (!sure.ok) {
      return sure
    }
  }

  let scansCreated = 0
  let reposScanned = 0
  // Track a blocking error (rate limit / auth) so we can surface it
  // instead of reporting silent success with "0 manifests". Without
  // this, a rate-limited GitHub token made every repo fail its tree
  // fetch, the outer loop swallowed each error, and the final summary
  // ("N repos / 0 manifests") misled users into thinking the scan
  // worked.
  let blockingError: CResult<undefined> | undefined
  const perRepoFailures: Array<{ repo: string; message: string }> = []
  for (let i = 0, { length } = targetRepos; i < length; i += 1) {
    const repoSlug = targetRepos[i]!
    reposScanned += 1
    const scanCResult = await scanRepo(repoSlug, {
      githubApiUrl,
      githubToken,
      orgSlug,
      orgGithub,
      outputKind,
      repos,
    })
    if (scanCResult.ok) {
      const { scanCreated } = scanCResult.data
      if (scanCreated) {
        scansCreated += 1
      }
      continue
    }
    perRepoFailures.push({
      repo: repoSlug,
      message: scanCResult.message,
    })
    // Stop on rate-limit / auth failures: every subsequent repo will
    // fail for the same reason and continuing only burns more quota
    // while delaying the real error.
    if (
      scanCResult.message === GITHUB_ERR_ABUSE_DETECTION ||
      scanCResult.message === GITHUB_ERR_AUTH_FAILED ||
      scanCResult.message === GITHUB_ERR_GRAPHQL_RATE_LIMIT ||
      scanCResult.message === GITHUB_ERR_RATE_LIMIT
    ) {
      blockingError = {
        ok: false,
        message: scanCResult.message,
        cause: scanCResult.cause,
      }
      break
    }
  }

  if (blockingError) {
    logger.fail(blockingError.message)
    return blockingError
  }

  logger.success(reposScanned, 'GitHub repos processed')
  logger.success(scansCreated, 'with supported Manifest files')

  // If every repo failed but not for a known-blocking reason, treat
  // the run as an error so scripts know something went wrong instead
  // of inferring success from an ok: true with 0 scans.
  if (
    reposScanned > 0 &&
    scansCreated === 0 &&
    perRepoFailures.length === reposScanned
  ) {
    const firstFailure = perRepoFailures[0]!
    return {
      ok: false,
      message: 'All repos failed to scan',
      cause:
        `All ${reposScanned} repos failed to scan. First failure for ${firstFailure.repo}: ${firstFailure.message}. ` +
        'Check the log above for per-repo details.',
    }
  }

  return {
    ok: true,
    data: undefined,
  }
}

export async function scanOneRepo(
  repoSlug: string,
  {
    orgGithub,
    orgSlug,
    outputKind,
  }: {
    githubApiUrl: string
    githubToken: string
    orgSlug: string
    orgGithub: string
    outputKind: OutputKind
    repos: string
  },
): Promise<CResult<{ scanCreated: boolean }>> {
  const repoResult = await getRepoDetails({
    orgGithub,
    repoSlug,
    githubApiUrl: '',
    githubToken: '',
  })
  if (!repoResult.ok) {
    return repoResult
  }
  const { defaultBranch } = repoResult.data

  logger.info(`Default branch: \`${defaultBranch}\``)

  const treeResult = await getRepoBranchTree({
    defaultBranch,
    orgGithub,
    repoSlug,
  })
  if (!treeResult.ok) {
    return treeResult
  }
  const files = treeResult.data

  if (!files.length) {
    logger.warn(
      'No files were reported for the default branch. Moving on to next repo.',
    )
    return { ok: true, data: { scanCreated: false } }
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), repoSlug))
  debug(`init: temp dir for scan root ${tmpDir}`)

  const downloadResult = await testAndDownloadManifestFiles({
    defaultBranch,
    files,
    orgGithub,
    repoSlug,
    tmpDir,
  })
  if (!downloadResult.ok) {
    return downloadResult
  }

  const commitResult = await getLastCommitDetails({
    defaultBranch,
    orgGithub,
    repoSlug,
  })
  if (!commitResult.ok) {
    return commitResult
  }

  const { lastCommitMessage, lastCommitSha, lastCommitter } = commitResult.data

  // Make request for full scan
  // I think we can just kick off the socket scan create command now...

  await handleCreateNewScan({
    autoManifest: false,
    basics: false,
    branchName: defaultBranch,
    commitHash: lastCommitSha,
    commitMessage: lastCommitMessage || '',
    committers: lastCommitter || '',
    cwd: tmpDir,
    defaultBranch: true,
    interactive: false,
    orgSlug,
    outputKind,
    pendingHead: true,
    pullRequest: 0,
    reach: {
      excludePaths: [],
      runReachabilityAnalysis: false,
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
    },
    readOnly: false,
    repoName: repoSlug,
    report: false,
    reportLevel: REPORT_LEVEL_ERROR,
    targets: ['.'],
    tmp: false,
  })

  return { ok: true, data: { scanCreated: true } }
}

export async function scanRepo(
  repoSlug: string,
  {
    githubApiUrl,
    githubToken,
    orgGithub,
    orgSlug,
    outputKind,
    repos,
  }: {
    githubApiUrl: string
    githubToken: string
    orgSlug: string
    orgGithub: string
    outputKind: OutputKind
    repos: string
  },
): Promise<CResult<{ scanCreated: boolean }>> {
  logger.info(
    `Requesting repo details from GitHub API for: \`${orgGithub}/${repoSlug}\`...`,
  )
  logger.group()
  const result = await scanOneRepo(repoSlug, {
    githubApiUrl,
    githubToken,
    orgSlug,
    orgGithub,
    outputKind,
    repos,
  })
  logger.groupEnd()
  logger.log('')
  return result
}

// Interactive prompts extracted to keep this file under the 500-line File-size cap.
import { makeSure, selectFocus } from './create-scan-from-github-prompts.mts'

export { makeSure, selectFocus }

// GitHub API helpers extracted to keep this file under the 500-line File-size cap.
import {
  getLastCommitDetails,
  getRepoBranchTree,
  getRepoDetails,
} from './create-scan-from-github-api.mts'

export { getLastCommitDetails, getRepoBranchTree, getRepoDetails }

// Manifest download helpers extracted to keep this file under the 500-line File-size cap.
import {
  cleanupPartialDownload,
  downloadManifestFile,
  streamDownloadWithFetch,
  testAndDownloadManifestFile,
} from './github-scan-manifest.mts'

export {
  cleanupPartialDownload,
  downloadManifestFile,
  streamDownloadWithFetch,
  testAndDownloadManifestFile,
}
