import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, select } from '@socketsecurity/registry/lib/prompts'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import constants from '../../constants.mts'
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
  if (all || targetRepos.length === 0) {
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

  let scansCreated = 0
  for (const repoSlug of targetRepos) {
    // eslint-disable-next-line no-await-in-loop
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
    }
  }

  logger.success(targetRepos.length, 'GitHub repos detected')
  logger.success(scansCreated, 'with supported Manifest files')

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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), repoSlug))
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
      runReachabilityAnalysis: false,
      reachDisableAnalytics: false,
      reachAnalysisTimeout: 0,
      reachAnalysisMemoryLimit: 0,
      reachEcosystems: [],
      reachExcludePaths: [],
      reachSkipCache: false,
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

  const downloadUrlResponse = await fetch(fileUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })
  debugFn('notice', 'complete: request')

  const downloadUrlText = await downloadUrlResponse.text()
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
    response = await fetch(downloadUrl)

    if (!response.ok) {
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
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const fileStream = fs.createWriteStream(localPath)

    // Using stream.pipeline for better error handling and cleanup

    await pipeline(response.body, fileStream)
    // 'pipeline' will automatically handle closing streams and propagating errors.
    // It resolves when the piping is fully complete and fileStream is closed.
    return { ok: true, data: localPath }
  } catch (error) {
    logger.fail(
      'An error was thrown while trying to download a manifest file... url:',
      downloadUrl,
    )
    debugDir('inspect', { error })

    // If an error occurs and fileStream was created, attempt to clean up.
    if (fs.existsSync(localPath)) {
      // Check if fileStream was even opened before trying to delete
      // This check might be too simplistic depending on when error occurs
      fs.unlink(localPath, unlinkErr => {
        if (unlinkErr) {
          logger.fail(
            `Error deleting partial file ${localPath}: ${unlinkErr.message}`,
          )
        }
      })
    }
    // Construct a more informative error message
    let detailedError = `Error during download of ${downloadUrl}: ${(error as { message: string }).message}`
    if ((error as { cause: string }).cause) {
      // Include cause if available (e.g., from network errors)
      detailedError += `\nCause: ${(error as { cause: string }).cause}`
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

  const commitResponse = await fetch(commitApiUrl, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })

  const commitText = await commitResponse.text()
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

  const repoDetailsResponse = await fetch(repoApiUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })
  logger.success(`Request completed.`)

  const repoDetailsText = await repoDetailsResponse.text()
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

  const treeResponse = await fetch(treeApiUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })

  const treeText = await treeResponse.text()
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
