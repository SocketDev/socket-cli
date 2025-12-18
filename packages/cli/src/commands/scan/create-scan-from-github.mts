import {
  createWriteStream,
  existsSync,
  promises as fs,
  mkdtempSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { debug, debugDir } from '@socketsecurity/lib/debug'
import { safeMkdirSync } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { confirm, select } from '@socketsecurity/lib/stdio/prompts'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { REPORT_LEVEL_ERROR } from '../../constants/reporting.mjs'
import { formatErrorWithDetail } from '../../utils/error/errors.mjs'
import { isReportSupportedFile } from '../../utils/fs/glob.mts'
import {
  getOctokit,
  withGitHubRetry,
} from '../../utils/git/github.mts'
import { fetchListAllRepos } from '../repository/fetch-list-all-repos.mts'

import type { CResult, OutputKind } from '../../types.mts'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'
const logger = getDefaultLogger()

type RepoListItem =
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

async function testAndDownloadManifestFiles({
  defaultBranch,
  files,
  orgGithub,
  repoSlug,
  tmpDir,
}: {
  defaultBranch: string
  files: string[]
  orgGithub: string
  repoSlug: string
  tmpDir: string
}): Promise<CResult<unknown>> {
  logger.info(
    `File tree for ${defaultBranch} contains`,
    files.length,
    'entries. Searching for supported manifest files...',
  )
  logger.group()
  let fileCount = 0
  let firstFailureResult: CResult<never> | undefined
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const result = await testAndDownloadManifestFile({
      defaultBranch,
      file,
      orgGithub,
      repoSlug,
      tmpDir,
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
  orgGithub,
  repoSlug,
  tmpDir,
}: {
  defaultBranch: string
  file: string
  orgGithub: string
  repoSlug: string
  tmpDir: string
}): Promise<CResult<{ isManifest: boolean }>> {
  debug(`testing: file ${file}`)

  const supportedFilesCResult = await fetchSupportedScanFileNames()
  const supportedFiles = supportedFilesCResult.ok
    ? supportedFilesCResult.data
    : undefined

  if (!supportedFiles || !isReportSupportedFile(file, supportedFiles)) {
    debug('skip: not a known pattern')
    // Not an error.
    return { ok: true, data: { isManifest: false } }
  }

  debug(`found: manifest file, going to attempt to download it; ${file}`)

  const result = await downloadManifestFile({
    defaultBranch,
    file,
    orgGithub,
    repoSlug,
    tmpDir,
  })

  return result.ok ? { ok: true, data: { isManifest: true } } : result
}

async function downloadManifestFile({
  defaultBranch,
  file,
  orgGithub,
  repoSlug,
  tmpDir,
}: {
  defaultBranch: string
  file: string
  orgGithub: string
  repoSlug: string
  tmpDir: string
}): Promise<CResult<undefined>> {
  debug('request: file content from GitHub')

  const octokit = getOctokit()

  const result = await withGitHubRetry(
    async () => {
      const { data } = await octokit.repos.getContent({
        owner: orgGithub,
        repo: repoSlug,
        path: file,
        ref: defaultBranch,
      })
      return data
    },
    `fetching file content for ${file} in ${orgGithub}/${repoSlug}`,
  )

  if (!result.ok) {
    logger.fail(`Failed to get file content for: ${file}`)
    return result
  }

  const fileData = result.data
  debug('complete: request')
  debugDir({ fileData: { type: (fileData as any).type, size: (fileData as any).size } })

  // Check if it's a file (not a directory).
  if (Array.isArray(fileData) || (fileData as any).type !== 'file') {
    return {
      ok: false,
      message: 'Not a file',
      cause: `Path ${file} is not a file in ${orgGithub}/${repoSlug}.`,
    }
  }

  const downloadUrl = (fileData as any).download_url
  if (!downloadUrl) {
    return {
      ok: false,
      message: 'Missing download URL',
      cause:
        `GitHub did not provide a download URL for ${file} in ${orgGithub}/${repoSlug}. ` +
        'The file may be too large or in an unsupported format.',
    }
  }

  const localPath = path.join(tmpDir, file)
  debug(`download: manifest file started ${downloadUrl} -> ${localPath}`)

  // Now stream the file to that file.
  const downloadResult = await streamDownloadWithFetch(localPath, downloadUrl)
  if (!downloadResult.ok) {
    logger.fail(
      `Failed to download manifest file, skipping to next file. File: ${file}`,
    )
    return downloadResult
  }

  debug('download: manifest file completed')

  return { ok: true, data: undefined }
}

// Courtesy of gemini:
async function streamDownloadWithFetch(
  localPath: string,
  downloadUrl: string,
): Promise<CResult<string>> {
  // Declare response here to access it in catch if needed.
  let response: Response | undefined

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
    if (!existsSync(dir)) {
      safeMkdirSync(dir, { recursive: true })
    }

    const fileStream = createWriteStream(localPath)

    // Using stream.pipeline for better error handling and cleanup

    await pipeline(response.body, fileStream)
    // 'pipeline' will automatically handle closing streams and propagating errors.
    // It resolves when the piping is fully complete and fileStream is closed.
    return { ok: true, data: localPath }
  } catch (e) {
    logger.fail(
      'An error was thrown while trying to download a manifest file... url:',
      downloadUrl,
    )
    debugDir(e)

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
    debug(detailedError)
    return { ok: false, message: 'Download Failed', cause: detailedError }
  }
}

async function getLastCommitDetails({
  defaultBranch,
  orgGithub,
  repoSlug,
}: {
  defaultBranch: string
  orgGithub: string
  repoSlug: string
}): Promise<
  CResult<{
    lastCommitMessage: string
    lastCommitSha: string
    lastCommitter: string | undefined
  }>
> {
  logger.info(
    `Requesting last commit for default branch ${defaultBranch} for ${orgGithub}/${repoSlug}...`,
  )

  const octokit = getOctokit()

  const result = await withGitHubRetry(
    async () => {
      const { data } = await octokit.repos.listCommits({
        owner: orgGithub,
        repo: repoSlug,
        sha: defaultBranch,
        per_page: 1,
      })
      return data
    },
    `fetching latest commit SHA for ${orgGithub}/${repoSlug}`,
  )

  if (!result.ok) {
    return result
  }

  const commits = result.data
  debugDir({ commits })

  if (!commits.length) {
    return {
      ok: false,
      message: 'No commits found',
      cause:
        `No commits found on branch ${defaultBranch} for ${orgGithub}/${repoSlug}. ` +
        'The repository may be empty.',
    }
  }

  const lastCommit = commits[0]!
  const lastCommitSha = lastCommit.sha

  if (!lastCommitSha) {
    return {
      ok: false,
      message: 'Missing commit SHA',
      cause:
        `Unable to get last commit SHA for ${orgGithub}/${repoSlug}. ` +
        'The GitHub API response was missing the SHA field.',
    }
  }

  // Extract committer information.
  const authorName = lastCommit.commit?.author?.name
  const committerName = lastCommit.commit?.committer?.name
  const lastCommitter = authorName || committerName
  const lastCommitMessage = lastCommit.commit?.message || ''

  return { ok: true, data: { lastCommitMessage, lastCommitSha, lastCommitter } }
}

async function selectFocus(repos: string[]): Promise<CResult<string[]>> {
  const proceed = await select({
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
  orgGithub,
  repoSlug,
}: {
  orgGithub: string
  repoSlug: string
  githubApiUrl: string
  githubToken: string
}): Promise<
  CResult<{ defaultBranch: string; repoDetails: unknown }>
> {
  const octokit = getOctokit()

  const result = await withGitHubRetry(
    async () => {
      const { data } = await octokit.repos.get({
        owner: orgGithub,
        repo: repoSlug,
      })
      return data
    },
    `fetching repository details for ${orgGithub}/${repoSlug}`,
  )

  if (!result.ok) {
    return result
  }

  const repoDetails = result.data
  logger.success('Request completed.')
  debugDir({ repoDetails })

  const defaultBranch = repoDetails.default_branch
  if (!defaultBranch) {
    return {
      ok: false,
      message: 'Default branch not found',
      cause:
        `Repository ${orgGithub}/${repoSlug} does not have a default branch set. ` +
        'This can happen with empty repositories or misconfigured repo settings.',
    }
  }

  return { ok: true, data: { defaultBranch, repoDetails } }
}

async function getRepoBranchTree({
  defaultBranch,
  orgGithub,
  repoSlug,
}: {
  defaultBranch: string
  orgGithub: string
  repoSlug: string
}): Promise<CResult<string[]>> {
  logger.info(
    `Requesting default branch file tree; branch \`${defaultBranch}\`, repo \`${orgGithub}/${repoSlug}\`...`,
  )

  const octokit = getOctokit()

  const result = await withGitHubRetry(
    async () => {
      const { data } = await octokit.git.getTree({
        owner: orgGithub,
        repo: repoSlug,
        tree_sha: defaultBranch,
        recursive: 'true',
      })
      return data
    },
    `fetching file tree for branch ${defaultBranch} in ${orgGithub}/${repoSlug}`,
  )

  if (!result.ok) {
    // Check if it's an empty repo error (404 with specific message).
    if (result.message === 'GitHub resource not found') {
      logger.warn(
        `GitHub reports the default branch of repo ${repoSlug} may be empty or not found. Moving on to next repo.`,
      )
      return { ok: true, data: [] }
    }
    return result
  }

  const treeDetails = result.data
  debugDir({ treeDetails })

  if (!treeDetails.tree || !Array.isArray(treeDetails.tree)) {
    debugDir({ treeDetails: { tree: treeDetails.tree } })

    return {
      ok: false,
      message: 'Invalid tree response',
      cause:
        `Tree response for default branch ${defaultBranch} for ${orgGithub}/${repoSlug} was not a list. ` +
        'The repository may be empty or in an unexpected state.',
    }
  }

  const files = treeDetails.tree
    .filter(obj => obj.type === 'blob')
    .map(obj => obj.path!)
    .filter(Boolean)

  return { ok: true, data: files }
}
