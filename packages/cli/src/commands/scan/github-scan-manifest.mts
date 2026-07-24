/**
 * Manifest file download helpers for `socket scan github`.
 *
 * Extracted from create-scan-from-github.mts to keep that file under the
 * 500-line soft cap. These wrap the GitHub content API and a raw fetch
 * stream to pull supported manifest files down into a local scan tmp dir.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { safeDelete, safeMkdirSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { fetchSupportedScanFileNames } from './fetch-supported-scan-file-names.mts'
import { formatErrorWithDetail } from '../../util/error/errors.mjs'
import { isReportSupportedFile } from '../../util/fs/glob.mts'
import { socketHttpRequest } from '../../util/socket/api.mjs'
import { getOctokit, withGitHubRetry } from '../../util/git/github.mts'

import type { CResult } from '../../types.mts'
import type { SupportedFiles } from '../../util/fs/glob.mts'

const logger = getDefaultLogger()

// Best-effort cleanup of a partial download. Isolated in its own function so
// its catch handler doesn't shadow the caller's catch binding.
export async function cleanupPartialDownload(localPath: string): Promise<void> {
  try {
    await safeDelete(localPath, { force: true })
  } catch (e) {
    logger.fail(
      formatErrorWithDetail(`Error deleting partial file ${localPath}`, e),
    )
  }
}

export async function downloadManifestFile({
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

  const result = await withGitHubRetry(async () => {
    const { data } = await octokit.repos.getContent({
      owner: orgGithub,
      repo: repoSlug,
      path: file,
      ref: defaultBranch,
    })
    return data
  }, `fetching file content for ${file} in ${orgGithub}/${repoSlug}`)

  if (!result.ok) {
    logger.fail(`Failed to get file content for: ${file}`)
    return result
  }

  const fileData = result.data as {
    type?: string | undefined
    size?: number | undefined
    download_url?: string | null | undefined
  }
  debug('complete: request')
  debugDir({
    fileData: { type: fileData.type, size: fileData.size },
  })

  // Check if it's a file (not a directory).
  if (Array.isArray(fileData) || fileData.type !== 'file') {
    return {
      ok: false,
      message: 'Not a file',
      cause: `Path ${file} is not a file in ${orgGithub}/${repoSlug}.`,
    }
  }

  const downloadUrl = fileData.download_url
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
export async function streamDownloadWithFetch(
  localPath: string,
  downloadUrl: string,
): Promise<CResult<string>> {
  try {
    // Use longer timeout for file downloads (5 minutes).
    const response = await socketHttpRequest(downloadUrl, {
      timeout: 300_000,
    })

    if (!response.ok) {
      const errorMsg = `Download failed due to bad server response: ${response.status} ${response.statusText} for ${downloadUrl}`
      logger.fail(errorMsg)
      return { ok: false, message: 'Download Failed', cause: errorMsg }
    }

    // Make sure the dir exists. It may be nested and we need to construct that
    // before starting the download.
    const dir = path.dirname(localPath)
    if (!existsSync(dir)) {
      safeMkdirSync(dir, { recursive: true })
    }

    await fs.writeFile(localPath, response.body)
    return { ok: true, data: localPath }
  } catch (e) {
    logger.fail(
      'An error was thrown while trying to download a manifest file… url:',
      downloadUrl,
    )
    debugDir(e)

    // If an error occurs and fileStream was created, attempt to clean up.
    await cleanupPartialDownload(localPath)
    // Construct a more informative error message
    let detailedError = `Error during download of ${downloadUrl}: ${(e as { message: string }).message}`
    if ((e as { cause: string }).cause) {
      // Include cause if available (e.g., from network errors)
      detailedError += `\nCause: ${(e as { cause: string }).cause}`
    }
    debug(detailedError)
    return { ok: false, message: 'Download Failed', cause: detailedError }
  }
}

export async function testAndDownloadManifestFile({
  defaultBranch,
  file,
  orgGithub,
  repoSlug,
  supportedFiles,
  tmpDir,
}: {
  defaultBranch: string
  file: string
  orgGithub: string
  repoSlug: string
  supportedFiles: SupportedFiles | undefined
  tmpDir: string
}): Promise<CResult<{ isManifest: boolean }>> {
  debug(`testing: file ${file}`)

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

export async function testAndDownloadManifestFiles({
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
    'entries. Searching for supported manifest files…',
  )

  // Fetch supported files once for all file checks (avoid repeated API calls).
  const supportedFilesCResult = await fetchSupportedScanFileNames()
  const supportedFiles = supportedFilesCResult.ok
    ? supportedFilesCResult.data
    : undefined

  logger.group()
  let fileCount = 0
  let firstFailureResult: CResult<never> | undefined
  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]!
    const result = await testAndDownloadManifestFile({
      defaultBranch,
      file,
      orgGithub,
      repoSlug,
      supportedFiles,
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
