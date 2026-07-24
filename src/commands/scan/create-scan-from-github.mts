import {
  createWriteStream,
  existsSync,
  promises as fs,
  mkdirSync,
  mkdtempSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, select } from '@socketsecurity/registry/lib/prompts'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import constants from '../../constants.mts'
import { apiFetch } from '../../utils/api.mts'
import { debugApiRequest, debugApiResponse } from '../../utils/debug.mts'
import { formatErrorWithDetail } from '../../utils/errors.mts'
import {
  classifyGitHubResponse,
  githubApiRequest,
  isGitHubBlockingError,
} from '../../utils/github-errors.mts'
import { isReportSupportedFile } from '../../utils/glob.mts'
import { fetchListAllRepos } from '../repository/fetch-list-all-repos.mts'

import type { CResult, OutputKind } from '../../types.mts'

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
    targetRepos = result.data.results.map(obj => obj.slug || '')
  }

  targetRepos = targetRepos.map(s => s.trim()).filter(Boolean)

  logger.info(`Have ${targetRepos.length} repo names to Scan!`)
  logger.log('')

  if (!targetRepos.filter(Boolean).length) {
    return {
      ok: false,
      message: 'No repo found',
      cause:
        'You did not set the --repos value and/or the server responded with zero repos when asked for some. Unable to proceed.',
    }
  }

  // Non-interactive or explicitly requested; just do it.
  if (interactive && targetRepos.length > 1 && !all && !repos) {
    const which = await selectFocus(targetRepos)
    if (!which.ok) {
      return which
    }
    targetRepos = which.data
  }

  // 10 is an arbitrary number. Maybe confirm whenever count>1 ?
  // Do not ask to confirm when the list was given explicit.
  if (interactive && (all || !repos) && targetRepos.length > 10) {
    const sure = await makeSure(targetRepos.length)
    if (!sure.ok) {
      return sure
    }
  }

  return await runGithubScanLoop(targetRepos, repoSlug =>
    scanRepo(repoSlug, {
      githubApiUrl,
      githubToken,
      orgSlug,
      orgGithub,
      outputKind,
      repos,
    }),
  )
}

/**
 * Drive the per-repo scan loop and decide the overall run result.
 *
 * The loop stops early on a blocking GitHub error (rate limit / auth / abuse
 * detection) because every remaining repo would fail the same way — that is
 * the ASK-167 bug: a rate-limited token made every repo fail its API calls,
 * the loop swallowed each failure, and the final "N repos / 0 manifests"
 * summary misled users and CI into thinking the scan succeeded when nothing
 * was uploaded. A run where every attempted repo failed for a non-blocking
 * reason is also surfaced as an error rather than a silent ok:true.
 *
 * `scanRepoFn` is injected so this decision logic can be tested without the
 * GitHub network path.
 */
export async function runGithubScanLoop(
  targetRepos: string[],
  scanRepoFn: (repoSlug: string) => Promise<CResult<{ scanCreated: boolean }>>,
): Promise<CResult<undefined>> {
  let scansCreated = 0
  let reposScanned = 0
  let blockingError: CResult<undefined> | undefined
  const perRepoFailures: Array<{ repo: string; message: string }> = []
  for (const repoSlug of targetRepos) {
    reposScanned += 1
    // eslint-disable-next-line no-await-in-loop
    const scanCResult = await scanRepoFn(repoSlug)
    if (scanCResult.ok) {
      const { scanCreated } = scanCResult.data
      if (scanCreated) {
        scansCreated += 1
      }
      continue
    }
    perRepoFailures.push({ repo: repoSlug, message: scanCResult.message })
    // Stop on rate-limit / auth / abuse failures: every remaining repo will
    // fail for the same reason, and continuing only burns more quota while
    // delaying the real error.
    if (isGitHubBlockingError(scanCResult.message)) {
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

  // If every attempted repo failed (but not for a known blocking reason),
  // treat the run as an error so scripts do not infer success from an
  // ok:true with zero scans created.
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
        'See the log above for per-repo details.',
    }
  }

  return {
    ok: true,
    data: undefined,
  }
}

async function scanRepo(
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

async function scanOneRepo(
  repoSlug: string,
  {
    githubApiUrl,
    githubToken,
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
    githubApiUrl,
    githubToken,
  })
  if (!repoResult.ok) {
    return repoResult
  }
  const { defaultBranch, repoApiUrl } = repoResult.data

  logger.info(`Default branch: \`${defaultBranch}\``)

  const treeResult = await getRepoBranchTree({
    defaultBranch,
    githubToken,
    orgGithub,
    repoSlug,
    repoApiUrl,
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
  debugFn('notice', 'init: temp dir for scan root', tmpDir)

  const downloadResult = await testAndDownloadManifestFiles({
    files,
    tmpDir,
    repoSlug,
    defaultBranch,
    orgGithub,
    repoApiUrl,
    githubToken,
  })
  if (!downloadResult.ok) {
    return downloadResult
  }

  const commitResult = await getLastCommitDetails({
    orgGithub,
    repoSlug,
    defaultBranch,
    repoApiUrl,
    githubToken,
  })
  if (!commitResult.ok) {
    return commitResult
  }

  const { lastCommitMessage, lastCommitSha, lastCommitter } = commitResult.data

  // Make request for full scan
  // I think we can just kick off the socket scan create command now...

  await handleCreateNewScan({
    autoManifest: false,
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
      reachAnalysisMemoryLimit: '',
      reachAnalysisTimeout: '',
      reachConcurrency: 1,
      reachContinueOnAnalysisErrors: false,
      reachContinueOnInstallErrors: false,
      reachContinueOnMissingLockFiles: false,
      reachContinueOnNoSourceFiles: false,
      reachDebug: false,
      reachDetailedAnalysisLogFile: false,
      reachDisableAnalytics: false,
      reachDisableExternalToolChecks: false,
      reachEcosystems: [],
      reachEnableAnalysisSplitting: false,
      reachExcludePaths: [],
      reachLazyMode: false,
      reachRetainFactsFile: false,
      reachSkipCache: false,
      reachUseOnlyPregeneratedSboms: false,
      reachVersion: undefined,
      runReachabilityAnalysis: false,
    },
    readOnly: false,
    repoName: repoSlug,
    report: false,
    reportLevel: constants.REPORT_LEVEL_ERROR,
    targets: ['.'],
    tmp: false,
  })

  return { ok: true, data: { scanCreated: true } }
}

async function testAndDownloadManifestFiles({
  defaultBranch,
  files,
  githubToken,
  orgGithub,
  repoApiUrl,
  repoSlug,
  tmpDir,
}: {
  files: string[]
  tmpDir: string
  repoSlug: string
  defaultBranch: string
  orgGithub: string
  repoApiUrl: string
  githubToken: string
}): Promise<CResult<unknown>> {
  logger.info(
    `File tree for ${defaultBranch} contains`,
    files.length,
    `entries. Searching for supported manifest files...`,
  )
  logger.group()
  let fileCount = 0
  let firstFailureResult
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const result = await testAndDownloadManifestFile({
      file,
      tmpDir,
      defaultBranch,
      repoApiUrl,
      githubToken,
    })
    if (result.ok) {
      if (result.data.isManifest) {
        fileCount += 1
      }
    } else if (!firstFailureResult) {
      firstFailureResult = result
    }
  }
  logger.groupEnd()
  logger.info('Found and downloaded', fileCount, 'manifest files')

  if (!fileCount) {
    if (firstFailureResult) {
      logger.fail(
        'While no supported manifest files were downloaded, at least one error encountered trying to do so. Showing the first error.',
      )
      return firstFailureResult
    }
    return {
      ok: false,
      message: 'No manifest files found',
      cause: `No supported manifest files were found in the latest commit on the branch ${defaultBranch} for repo ${orgGithub}/${repoSlug}. Skipping full scan.`,
    }
  }

  return { ok: true, data: undefined }
}

async function testAndDownloadManifestFile({
  defaultBranch,
  file,
  githubToken,
  repoApiUrl,
  tmpDir,
}: {
  file: string
  tmpDir: string
  defaultBranch: string
  repoApiUrl: string
  githubToken: string
}): Promise<CResult<{ isManifest: boolean }>> {
  debugFn('notice', 'testing: file', file)

  const supportedFilesCResult = await fetchSupportedScanFileNames()
  const supportedFiles = supportedFilesCResult.ok
    ? supportedFilesCResult.data
    : undefined

  if (!supportedFiles || !isReportSupportedFile(file, supportedFiles)) {
    debugFn('notice', 'skip: not a known pattern')
    // Not an error.
    return { ok: true, data: { isManifest: false } }
  }

  debugFn(
    'notice',
    'found: manifest file, going to attempt to download it;',
    file,
  )

  const result = await downloadManifestFile({
    file,
    tmpDir,
    defaultBranch,
    repoApiUrl,
    githubToken,
  })

  return result.ok ? { ok: true, data: { isManifest: true } } : result
}

async function downloadManifestFile({
  defaultBranch,
  file,
  githubToken,
  repoApiUrl,
  tmpDir,
}: {
  file: string
  tmpDir: string
  defaultBranch: string
  repoApiUrl: string
  githubToken: string
}): Promise<CResult<undefined>> {
  debugFn('notice', 'request: download url from GitHub')

  const fileUrl = `${repoApiUrl}/contents/${file}?ref=${defaultBranch}`
  debugDir('inspect', { fileUrl })

  const reqResult = await githubApiRequest(
    fileUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${githubToken}`,
      },
    },
    `fetching the download URL for ${file}`,
  )
  if (!reqResult.ok) {
    return reqResult
  }
  debugFn('notice', 'complete: request')

  const downloadUrlText = reqResult.data.bodyText
  debugFn('inspect', 'response: raw download url', downloadUrlText)

  let downloadUrl
  try {
    downloadUrl = JSON.parse(downloadUrlText).download_url
  } catch {
    logger.fail(
      `GitHub response contained invalid JSON for download url for: ${file}`,
    )

    return {
      ok: false,
      message: 'Invalid JSON response',
      cause: `Server responded with invalid JSON for download url ${downloadUrl}`,
    }
  }

  const localPath = path.join(tmpDir, file)
  debugFn(
    'notice',
    'download: manifest file started',
    downloadUrl,
    '->',
    localPath,
  )

  // Now stream the file to that file...
  const result = await streamDownloadWithFetch(localPath, downloadUrl)
  if (!result.ok) {
    // Do we proceed? Bail? Hrm...
    logger.fail(
      `Failed to download manifest file, skipping to next file. File: ${file}`,
    )
    return result
  }

  debugFn('notice', 'download: manifest file completed')

  return { ok: true, data: undefined }
}

// Courtesy of gemini:
async function streamDownloadWithFetch(
  localPath: string,
  downloadUrl: string,
): Promise<CResult<string>> {
  let response // Declare response here to access it in catch if needed

  try {
    debugApiRequest('GET', downloadUrl)
    response = await apiFetch(downloadUrl)
    debugApiResponse('GET', downloadUrl, response.status)

    if (!response.ok) {
      // Surface rate-limit / auth failures on the raw download host too, so a
      // bulk run that trips the limit mid-download fails loudly instead of
      // being counted as just another skipped file. Header/status-only check;
      // the stream body is left unconsumed.
      const blocking = classifyGitHubResponse(
        response.status,
        response.headers,
        '',
        'downloading a manifest file',
      )
      if (blocking) {
        logger.fail(blocking.message)
        return blocking
      }
      const errorMsg = `Download failed due to bad server response: ${response.status} ${response.statusText} for ${downloadUrl}`
      logger.fail(errorMsg)
      return { ok: false, message: 'Download Failed', cause: errorMsg }
    }

    if (!response.body) {
      logger.fail(
        `Download failed because the server response was empty, for ${downloadUrl}`,
      )
      return {
        ok: false,
        message: 'Download Failed',
        cause: 'Response body is null or undefined.',
      }
    }

    // Make sure the dir exists. It may be nested and we need to construct that
    // before starting the download.
    const dir = path.dirname(localPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const fileStream = createWriteStream(localPath)

    // Using stream.pipeline for better error handling and cleanup

    await pipeline(response.body, fileStream)
    // 'pipeline' will automatically handle closing streams and propagating errors.
    // It resolves when the piping is fully complete and fileStream is closed.
    return { ok: true, data: localPath }
  } catch (e) {
    if (!response) {
      debugApiResponse('GET', downloadUrl, undefined, e)
    }
    logger.fail(
      'An error was thrown while trying to download a manifest file... url:',
      downloadUrl,
    )
    debugDir('error', e)

    // If an error occurs and fileStream was created, attempt to clean up.
    if (existsSync(localPath)) {
      // Check if fileStream was even opened before trying to delete
      // This check might be too simplistic depending on when error occurs
      try {
        await fs.unlink(localPath)
      } catch (e) {
        logger.fail(
          formatErrorWithDetail(`Error deleting partial file ${localPath}`, e),
        )
      }
    }
    // Construct a more informative error message
    let detailedError = `Error during download of ${downloadUrl}: ${(e as { message: string }).message}`
    if ((e as { cause: string }).cause) {
      // Include cause if available (e.g., from network errors)
      detailedError += `\nCause: ${(e as { cause: string }).cause}`
    }
    if (response && !response.ok) {
      // If error was due to bad HTTP status
      detailedError += ` (HTTP Status: ${response.status} ${response.statusText})`
    }
    debugFn('error', detailedError)
    return { ok: false, message: 'Download Failed', cause: detailedError }
  }
}

async function getLastCommitDetails({
  defaultBranch,
  githubToken,
  orgGithub,
  repoApiUrl,
  repoSlug,
}: {
  orgGithub: string
  repoSlug: string
  defaultBranch: string
  repoApiUrl: string
  githubToken: string
}): Promise<
  CResult<{
    lastCommitSha: string
    lastCommitter: string | undefined
    lastCommitMessage: string
  }>
> {
  logger.info(
    `Requesting last commit for default branch ${defaultBranch} for ${orgGithub}/${repoSlug}...`,
  )

  const commitApiUrl = `${repoApiUrl}/commits?sha=${defaultBranch}&per_page=1`
  debugFn('inspect', 'url: commit', commitApiUrl)

  const reqResult = await githubApiRequest(
    commitApiUrl,
    {
      headers: {
        Authorization: `Bearer ${githubToken}`,
      },
    },
    `fetching the latest commit for ${orgGithub}/${repoSlug}`,
  )
  if (!reqResult.ok) {
    return reqResult
  }

  const commitText = reqResult.data.bodyText
  debugFn('inspect', 'response: commit', commitText)

  let lastCommit
  try {
    lastCommit = JSON.parse(commitText)?.[0]
  } catch {
    logger.fail(`GitHub response contained invalid JSON for last commit`)
    logger.error(commitText)
    return {
      ok: false,
      message: 'Invalid JSON response',
      cause: `Server responded with invalid JSON for last commit of repo ${repoSlug}`,
    }
  }

  const lastCommitSha = lastCommit.sha
  const lastCommitter = Array.from(
    new Set([lastCommit.commit.author.name, lastCommit.commit.committer.name]),
  )[0]
  const lastCommitMessage = lastCommit.message

  if (!lastCommitSha) {
    return {
      ok: false,
      message: 'Missing commit SHA',
      cause: 'Unable to get last commit for repo',
    }
  }

  if (!lastCommitter) {
    return {
      ok: false,
      message: 'Missing committer',
      cause: 'Last commit does not have information about who made the commit',
    }
  }

  return { ok: true, data: { lastCommitSha, lastCommitter, lastCommitMessage } }
}

async function selectFocus(repos: string[]): Promise<CResult<string[]>> {
  const proceed = await select<string>({
    message: 'Please select the repo to process:',
    choices: repos
      .map(slug => ({
        name: slug,
        value: slug,
        description: `Create scan for the ${slug} repo through GitHub`,
      }))
      .concat({
        name: '(Exit)',
        value: '',
        description: 'Cancel this action and exit',
      }),
  })
  if (!proceed) {
    return {
      ok: false,
      message: 'Canceled by user',
      cause: 'User chose to cancel the action',
    }
  }
  return { ok: true, data: [proceed] }
}

async function makeSure(count: number): Promise<CResult<undefined>> {
  if (
    !(await confirm({
      message: `Are you sure you want to run this for ${count} repos?`,
      default: false,
    }))
  ) {
    return {
      ok: false,
      message: 'User canceled',
      cause: 'Action canceled by user',
    }
  }
  return { ok: true, data: undefined }
}

async function getRepoDetails({
  githubApiUrl,
  githubToken,
  orgGithub,
  repoSlug,
}: {
  orgGithub: string
  repoSlug: string
  githubApiUrl: string
  githubToken: string
}): Promise<
  CResult<{ defaultBranch: string; repoDetails: unknown; repoApiUrl: string }>
> {
  const repoApiUrl = `${githubApiUrl}/repos/${orgGithub}/${repoSlug}`
  debugDir('inspect', { repoApiUrl })

  const reqResult = await githubApiRequest(
    repoApiUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${githubToken}`,
      },
    },
    `fetching repo details for ${orgGithub}/${repoSlug}`,
  )
  if (!reqResult.ok) {
    return reqResult
  }
  logger.success(`Request completed.`)

  const repoDetailsText = reqResult.data.bodyText
  debugFn('inspect', 'response: repo', repoDetailsText)

  let repoDetails
  try {
    repoDetails = JSON.parse(repoDetailsText)
  } catch {
    logger.fail(`GitHub response contained invalid JSON for repo ${repoSlug}`)
    logger.error(repoDetailsText)
    return {
      ok: false,
      message: 'Invalid JSON response',
      cause: `Server responded with invalid JSON for repo ${repoSlug}`,
    }
  }

  const defaultBranch = repoDetails.default_branch
  if (!defaultBranch) {
    return {
      ok: false,
      message: 'Default Branch Not Found',
      cause: `Repo ${repoSlug} does not have a default branch set or it was not reported`,
    }
  }

  return { ok: true, data: { defaultBranch, repoDetails, repoApiUrl } }
}

async function getRepoBranchTree({
  defaultBranch,
  githubToken,
  orgGithub,
  repoApiUrl,
  repoSlug,
}: {
  defaultBranch: string
  githubToken: string
  orgGithub: string
  repoApiUrl: string
  repoSlug: string
}): Promise<CResult<string[]>> {
  logger.info(
    `Requesting default branch file tree; branch \`${defaultBranch}\`, repo \`${orgGithub}/${repoSlug}\`...`,
  )

  const treeApiUrl = `${repoApiUrl}/git/trees/${defaultBranch}?recursive=1`
  debugFn('inspect', 'url: tree', treeApiUrl)

  const reqResult = await githubApiRequest(
    treeApiUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${githubToken}`,
      },
    },
    `fetching the file tree for ${orgGithub}/${repoSlug}`,
  )
  if (!reqResult.ok) {
    return reqResult
  }

  const treeText = reqResult.data.bodyText
  debugFn('inspect', 'response: tree', treeText)

  let treeDetails
  try {
    treeDetails = JSON.parse(treeText)
  } catch {
    logger.fail(
      `GitHub response contained invalid JSON for default branch of repo ${repoSlug}`,
    )
    logger.error(treeText)
    return {
      ok: false,
      message: 'Invalid JSON response',
      cause: `Server responded with invalid JSON for repo ${repoSlug}`,
    }
  }

  if (treeDetails.message) {
    if (treeDetails.message === 'Git Repository is empty.') {
      logger.warn(
        `GitHub reports the default branch of repo ${repoSlug} to be empty. Moving on to next repo.`,
      )
      return { ok: true, data: [] }
    }

    logger.fail('Negative response from GitHub:', treeDetails.message)
    return {
      ok: false,
      message: 'Unexpected error response',
      cause: `GitHub responded with an unexpected error while asking for details on the default branch: ${treeDetails.message}`,
    }
  }

  if (!treeDetails.tree || !Array.isArray(treeDetails.tree)) {
    debugDir('inspect', { treeDetails: { tree: treeDetails.tree } })

    return {
      ok: false,
      message: `Tree response for default branch ${defaultBranch} for ${orgGithub}/${repoSlug} was not a list`,
    }
  }

  const files = (treeDetails.tree as Array<{ type: string; path: string }>)
    .filter(obj => obj.type === 'blob')
    .map(obj => obj.path)

  return { ok: true, data: files }
}
