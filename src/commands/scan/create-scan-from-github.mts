import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

// Supported manifest file name patterns
// (TODO: this is a port from the py script; we can probably use our API instead like we do for socket scan create? maybe?)
// Keep in mind that we have to request these through the GitHub API; that cost is much heavier than local disk searches
import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, select } from '@socketsecurity/registry/lib/prompts'

import { handleCreateNewScan } from './handle-create-new-scan.mts'
import { fetchListAllRepos } from '../repos/fetch-list-all-repos.mts'

import type { CResult, OutputKind } from '../../types.mts'

// TODO: get this list from API instead? Is that too much? Has to fetch through gh api...
const SUPPORTED_FILE_PATTERNS = [
  /.*[-.]spdx\.json/,
  /bom\.json/,
  /.*[-.]cyclonedx\.json/,
  /.*[-.]cyclonedx\.xml/,
  /package\.json/,
  /package-lock\.json/,
  /npm-shrinkwrap\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
  /pnpm-lock\.yml/,
  /pnpm-workspace\.yaml/,
  /pnpm-workspace\.yml/,
  /pipfile/,
  /pyproject\.toml/,
  /poetry\.lock/,
  /requirements[\\/].*\.txt/,
  /requirements-.*\.txt/,
  /requirements_.*\.txt/,
  /requirements\.frozen/,
  /setup\.py/,
  /pipfile\.lock/,
  /go\.mod/,
  /go\.sum/,
  /pom\.xml/,
  /.*\..*proj/,
  /.*\.props/,
  /.*\.targets/,
  /.*\.nuspec/,
  /nuget\.config/,
  /packages\.config/,
  /packages\.lock\.json/,
]

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
    .map(repo => repo.trim())
    .filter(Boolean)
  if (all || targetRepos.length === 0) {
    // Fetch from Socket API
    const result = await fetchListAllRepos({
      direction: 'asc',
      orgSlug,
      sort: 'name',
    })
    if (!result.ok) {
      return result
    }
    targetRepos = result.data.results.map(obj => obj.slug || '')
  }

  targetRepos = targetRepos.map(slug => slug.trim()).filter(Boolean)

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
    const proceed = await select<string>({
      message: 'Please select the repo to process:',
      choices: targetRepos
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
    targetRepos = [proceed]
  }

  // 10 is an arbitrary number. Maybe confirm whenever count>1 ?
  // Do not ask to confirm when the list was given explicit.
  if (interactive && (all || !repos) && targetRepos.length > 10) {
    if (
      !(await confirm({
        message: `Are you sure you want to run this for ${targetRepos.length} repos?`,
        default: false,
      }))
    ) {
      return {
        ok: false,
        message: 'User canceled',
        cause: 'Action canceled by user',
      }
    }
  }

  for (const repoSlug of targetRepos) {
    // eslint-disable-next-line no-await-in-loop
    await scanRepo(repoSlug, {
      githubApiUrl,
      githubToken,
      orgSlug,
      orgGithub,
      outputKind,
      repos,
    })
  }

  logger.success('Scanned', targetRepos.length, 'repos, or tried to, anyways!')

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
): Promise<CResult<undefined>> {
  logger.info(
    `Requesting repo details from GitHub API for: \`${orgGithub}/${repoSlug}\`...`,
  )
  console.group()
  const r = await _scanRepo(repoSlug, {
    githubApiUrl,
    githubToken,
    orgSlug,
    orgGithub,
    outputKind,
    repos,
  })
  console.groupEnd()
  logger.log('')
  return r
}

async function _scanRepo(
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
): Promise<CResult<undefined>> {
  const repoApiUrl = `${githubApiUrl}/repos/${orgGithub}/${repoSlug}`
  debugLog('Repo url:', repoApiUrl)
  const repoDetailsResponse = await fetch(repoApiUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })
  logger.success(`Request completed.`)

  const repoDetailsText = await repoDetailsResponse.text()

  debugLog('[DEBUG] Raw Repo Response:', repoDetailsText)

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

  logger.info(`Default branch: \`${defaultBranch}\``)

  logger.info(
    `Requesting default branch file tree; branch \`${defaultBranch}\`, repo \`${orgGithub}/${repoSlug}\`...`,
  )
  const treeApiUrl = `${repoApiUrl}/git/trees/${defaultBranch}?recursive=1`
  debugLog('Tree url:', treeApiUrl)
  const treeResponse = await fetch(treeApiUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })

  const treeText = await treeResponse.text()

  debugLog('[DEBUG] Raw Tree Response:', treeText)

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
        `GitHub reports the default branch of repo ${repos} to be empty. Moving on to next repo.`,
      )
      return { ok: true, data: undefined }
    }

    logger.fail('Negative response from GitHub:', treeDetails.message)
    return {
      ok: false,
      message: 'Unexpected error response',
      cause: `GitHub responded with an unexpected error while asking for details on the default branch: ${treeDetails.message}`,
    }
  }

  const tree = treeDetails.tree
  if (!tree || !Array.isArray(tree)) {
    debugLog('treeDetails.tree:', treeDetails.tree)
    return {
      ok: false,
      message: `Tree response for default branch ${defaultBranch} for ${orgGithub}/${repoSlug} was not a list`,
    }
  }

  const files = tree.filter(obj => obj.type === 'blob')
  if (!files) {
    logger.warn(
      'No files were reported for the default branch. Moving on to next repo.',
    )
    return { ok: true, data: undefined }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), repoSlug))
  debugLog(
    `[DEBUG] Temp dir for downloaded manifest (serves as scan root): ${tmpDir}`,
  )

  logger.info(
    `File tree contains ${files.length} entries. Searching for supported manifest files...`,
  )
  console.group()
  let fileCount = 0
  for (const file of files) {
    debugLog(`[DEBUG] Testing file:`, file)
    for (const regex of SUPPORTED_FILE_PATTERNS) {
      if (regex.test(file.path)) {
        logger.success(
          `Found a manifest file: \`${file.path}\`, will download it to temp dir...`,
        )
        console.group()

        logger.info('Requesting download url from GitHub...')
        const fileUrl = `${repoApiUrl}/contents/${file.path}?ref=${defaultBranch}`
        debugLog('[DEBUG] File url:', fileUrl)
        // eslint-disable-next-line no-await-in-loop
        const downloadUrlResponse = await fetch(fileUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${githubToken}`,
          },
        })
        logger.success(`Request completed.`)

        // eslint-disable-next-line no-await-in-loop
        const downloadUrlText = await downloadUrlResponse.text()

        debugLog('[DEBUG] raw download url response:')
        debugLog(downloadUrlText)

        let downloadUrl
        try {
          downloadUrl = JSON.parse(downloadUrlText).download_url
        } catch {
          logger.fail(
            `GitHub response contained invalid JSON for download url for file`,
          )
          logger.error(downloadUrlText)
          return {
            ok: false,
            message: 'Invalid JSON response',
            cause: `Server responded with invalid JSON for download url ${repoSlug}`,
          }
        }

        logger.info(`Downloading manifest file...`)

        // logger.info('Have download url. Now downloading file...', downloadUrl);
        const localPath = path.join(tmpDir, file.path)
        // Now stream the file to that file...
        // eslint-disable-next-line no-await-in-loop
        const result = await streamDownloadWithFetch(localPath, downloadUrl)
        if (result.ok) {
          fileCount += 1
          logger.success(`Downloaded manifest file.`)
        } else {
          // Do we proceed? Bail? Hrm...
          logger.fail(
            `Failed to download manifest file, skipping to next file. File: ${file.path}`,
          )
        }
        console.groupEnd()
      }
    }
  }
  logger.info('Found', fileCount, 'manifest files')
  console.groupEnd()

  if (!fileCount) {
    return {
      ok: false,
      message: 'No manifest files found',
      cause: `No supported manifest files were found in the latest commit on the default branch for repo ${repoSlug}. Skipping full scan.`,
    }
  }

  logger.info(
    `Requesting last commit for default branch ${defaultBranch} for ${orgGithub}/${repoSlug}...`,
  )
  const commitApiUrl = `${repoApiUrl}/commits?sha=${defaultBranch}&per_page=1`
  debugLog('Commit url:', commitApiUrl)
  const commitResponse = await fetch(commitApiUrl, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
    },
  })

  const commitText = await commitResponse.text()

  debugLog('[DEBUG] Raw Commit Response:', commitText)

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
    pullRequest: lastCommit.pull_request, // I think this works.. TODO: confirm
    readOnly: false,
    repoName: repoSlug,
    report: false,
    targets: ['.'],
    tmp: false,
  })

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
      const errorMsg = `Download failed: ${response.status} ${response.statusText} for ${downloadUrl}`
      return { ok: false, message: 'Download Failed', cause: errorMsg }
    }

    if (!response.body) {
      return {
        ok: false,
        message: 'Download Failed',
        cause: 'Response body is null or undefined.',
      }
    }

    const fileStream = fs.createWriteStream(localPath)

    // Using stream.pipeline for better error handling and cleanup

    await pipeline(response.body, fileStream)
    // 'pipeline' will automatically handle closing streams and propagating errors.
    // It resolves when the piping is fully complete and fileStream is closed.
    return { ok: true, data: localPath }
  } catch (error) {
    logger.fail('An error occurred trying to download the file...')
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
    return { ok: false, message: 'Download Failred', cause: detailedError }
  }
}
