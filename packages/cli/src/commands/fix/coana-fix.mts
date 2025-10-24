import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { joinAnd } from '@socketsecurity/lib/arrays'
import { debug, debugDir } from '@socketsecurity/lib/debug'
import { readJsonSync } from '@socketsecurity/lib/fs'
import { logger } from '@socketsecurity/lib/logger'
import { pluralize } from '@socketsecurity/lib/words'

import {
  checkCiEnvVars,
  getCiEnvInstructions,
  getFixEnv,
} from './env-helpers.mts'
import { getSocketFixBranchName, getSocketFixCommitMessage } from './git.mts'
import { getSocketFixPrs, openSocketFixPr } from './pull-request.mts'
import { FLAG_DRY_RUN } from '../../constants/cli.mts'
import { GQL_PR_STATE_OPEN } from '../../constants/github.mts'
import { spawnCoanaDlx } from '../../utils/dlx/spawn.mjs'
import { getErrorCause } from '../../utils/error/errors.mjs'
import { getPackageFilesForScan } from '../../utils/fs/path-resolve.mjs'
import {
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from '../../utils/git/git.mjs'
import {
  enablePrAutoMerge,
  fetchGhsaDetails,
  setGitRemoteGithubRepoUrl,
} from '../../utils/git/github.mts'
import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'

export async function coanaFix(
  fixConfig: FixConfig,
): Promise<CResult<{ data?: unknown; fixed: boolean }>> {
  const {
    applyFixes,
    autopilot,
    cwd,
    disableMajorUpdates,
    exclude,
    ghsas,
    include,
    limit,
    minimumReleaseAge,
    orgSlug,
    outputFile,
    outputKind,
    showAffectedDirectDependencies,
    spinner,
  } = fixConfig

  // Determine stdio based on output mode:
  // - 'ignore' when outputKind === 'json': suppress all coana output, return clean JSON response
  // - 'inherit' otherwise: user sees coana progress in real-time
  const coanaStdio = outputKind === 'json' ? 'ignore' : 'inherit'

  const fixEnv = await getFixEnv()
  debugDir({ fixEnv })

  spinner?.start()

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }

  const sockSdk = sockSdkCResult.data

  const supportedFilesCResult = await fetchSupportedScanFileNames({ spinner })
  if (!supportedFilesCResult.ok) {
    return supportedFilesCResult
  }

  const supportedFiles = supportedFilesCResult.data
  const scanFilepaths = await getPackageFilesForScan(['.'], supportedFiles, {
    cwd,
  })

  // SDK v3.0 automatically validates file readability via onFileValidation callback.
  const uploadCResult = await handleApiCall(
    sockSdk.uploadManifestFiles(orgSlug, scanFilepaths),
    {
      description: 'upload manifests',
      spinner,
    },
  )

  if (!uploadCResult.ok) {
    return uploadCResult
  }

  const tarHash: string = (uploadCResult as any).data.tarHash
  if (!tarHash) {
    spinner?.stop()
    return {
      ok: false,
      message:
        'No tar hash returned from Socket API upload-manifest-files endpoint',
      data: uploadCResult.data,
    }
  }

  const isAll =
    !ghsas.length ||
    (ghsas.length === 1 && (ghsas[0] === 'all' || ghsas[0] === 'auto'))

  const shouldOpenPrs = fixEnv.isCi && fixEnv.repoInfo

  if (!shouldOpenPrs) {
    // Inform user about local mode when fixes will be applied.
    if (applyFixes && ghsas.length) {
      const envCheck = checkCiEnvVars()
      if (envCheck.present.length) {
        // Some CI vars are set but not all - show what's missing.
        if (envCheck.missing.length) {
          logger.info(
            'Running in local mode - fixes will be applied directly to your working directory.\n' +
              `Missing environment variables for PR creation: ${joinAnd(envCheck.missing)}`,
          )
        }
      } else {
        // No CI vars are present - show general local mode message.
        logger.info(
          'Running in local mode - fixes will be applied directly to your working directory.\n' +
            getCiEnvInstructions(),
        )
      }
    }

    const ids = isAll ? ['all'] : ghsas.slice(0, limit)
    if (!ids.length) {
      spinner?.stop()
      return { ok: true, data: { fixed: false } }
    }

    // Create a temporary file for the output.
    const tmpDir = os.tmpdir()
    const tmpFile = path.join(tmpDir, `socket-fix-${Date.now()}.json`)

    try {
      const fixCResult = await spawnCoanaDlx(
        [
          'compute-fixes-and-upgrade-purls',
          cwd,
          '--manifests-tar-hash',
          tarHash,
          '--apply-fixes-to',
          ...(isAll ? ['all'] : ghsas),
          ...(fixConfig.rangeStyle
            ? ['--range-style', fixConfig.rangeStyle]
            : []),
          ...(minimumReleaseAge
            ? ['--minimum-release-age', minimumReleaseAge]
            : []),
          ...(include.length ? ['--include', ...include] : []),
          ...(exclude.length ? ['--exclude', ...exclude] : []),
          ...(!applyFixes ? [FLAG_DRY_RUN] : []),
          '--output-file',
          tmpFile,
          ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
          ...(showAffectedDirectDependencies
            ? ['--show-affected-direct-dependencies']
            : []),
          ...fixConfig.unknownFlags,
        ],
        fixConfig.orgSlug,
        { cwd, spinner, stdio: coanaStdio },
      )

      spinner?.stop()

      if (!fixCResult.ok) {
        return fixCResult
      }

      // Read the temporary file to get the actual fixes result.
      const fixesResultJson = readJsonSync(tmpFile, { throws: false })

      // Copy to outputFile if provided.
      if (outputFile) {
        logger.info(`Copying fixes result to ${outputFile}`)
        const tmpContent = await fs.readFile(tmpFile, 'utf8')
        await fs.writeFile(outputFile, tmpContent, 'utf8')
      }

      return { ok: true, data: { data: fixesResultJson, fixed: true } }
    } finally {
      // Clean up the temporary file.
      try {
        await fs.unlink(tmpFile)
      } catch (_e) {
        // Ignore cleanup errors.
      }
    }
  }

  // Adjust limit based on open Socket Fix PRs.
  let adjustedLimit = limit
  if (shouldOpenPrs && fixEnv.repoInfo) {
    try {
      const openPrs = await getSocketFixPrs(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        { states: GQL_PR_STATE_OPEN },
      )
      const openPrCount = openPrs.length
      // Reduce limit by number of open PRs to avoid creating too many.
      adjustedLimit = Math.max(0, limit - openPrCount)
      if (openPrCount > 0) {
        debug(
          `limit: adjusted from ${limit} to ${adjustedLimit} (${openPrCount} open Socket Fix ${pluralize('PR', { count: openPrCount })}`,
        )
      }
    } catch (e) {
      debug('Failed to count open PRs, using original limit')
      debugDir(e)
    }
  }

  const shouldSpawnCoana = adjustedLimit > 0

  let ids: string[] | undefined

  // When isAll is true, discover vulnerabilities by running coana with --output-file.
  // This gives us the GHSA IDs needed to create individual PRs in CI mode.
  if (shouldSpawnCoana && isAll) {
    const discoverTmpFile = path.join(os.tmpdir(), `socket-discover-${Date.now()}.json`)

    try {
      const discoverCResult = await spawnCoanaDlx(
        [
          'compute-fixes-and-upgrade-purls',
          cwd,
          '--manifests-tar-hash',
          tarHash,
          '--show-affected-direct-dependencies',
          '--output-file',
          discoverTmpFile,
          ...(fixConfig.rangeStyle
            ? ['--range-style', fixConfig.rangeStyle]
            : []),
          ...(minimumReleaseAge
            ? ['--minimum-release-age', minimumReleaseAge]
            : []),
          ...(include.length ? ['--include', ...include] : []),
          ...(exclude.length ? ['--exclude', ...exclude] : []),
          ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
          ...fixConfig.unknownFlags,
        ],
        fixConfig.orgSlug,
        { cwd, spinner, stdio: coanaStdio },
      )

      if (discoverCResult.ok) {
        const discoverResult = readJsonSync(discoverTmpFile, { throws: false })
        // Extract GHSA IDs from the discovery result.
        // When compute-fixes-and-upgrade-purls is called without --apply-fixes-to,
        // it returns { type: 'no-ghsas-fix-requested', ghsas: [...] }
        const discoveredIds = (Array.isArray((discoverResult as any)?.ghsas) ? (discoverResult as any).ghsas : [])
        ids = discoveredIds.slice(0, adjustedLimit)
      }

      // Clean up discovery temp file.
      try {
        await fs.unlink(discoverTmpFile)
      } catch (_e) {
        // Ignore cleanup errors.
      }
    } catch (e) {
      debug('Failed to discover vulnerabilities')
      debugDir(e)
    }
  } else if (shouldSpawnCoana) {
    ids = ghsas.slice(0, adjustedLimit)
  }

  if (!ids?.length) {
    debug('miss: no GHSA IDs to process')
  }

  if (!fixEnv.repoInfo) {
    debug('miss: no repo info detected')
  }

  if (!ids?.length || !fixEnv.repoInfo) {
    spinner?.stop()
    return { ok: true, data: { fixed: false } }
  }

  const displayIds =
    ids.length > 3
      ? `${ids.slice(0, 3).join(', ')} … and ${ids.length - 3} more`
      : joinAnd(ids)
  debug(`fetch: ${ids.length} GHSA details for ${displayIds}`)

  const ghsaDetails = await fetchGhsaDetails(ids)
  const scanBaseNames = new Set(scanFilepaths.map(p => path.basename(p)))

  debug(`found: ${ghsaDetails.size} GHSA details`)

  let count = 0
  let overallFixed = false

  // Process each GHSA ID individually.
  for (let i = 0, { length } = ids; i < length; i += 1) {
    const ghsaId = ids[i]!
    debug(`check: ${ghsaId}`)

    // Apply fix for single GHSA ID.
    // eslint-disable-next-line no-await-in-loop
    const fixCResult = await spawnCoanaDlx(
      [
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--manifests-tar-hash',
        tarHash,
        '--apply-fixes-to',
        ghsaId,
        ...(fixConfig.rangeStyle
          ? ['--range-style', fixConfig.rangeStyle]
          : []),
        ...(minimumReleaseAge
          ? ['--minimum-release-age', minimumReleaseAge]
          : []),
        ...(include.length ? ['--include', ...include] : []),
        ...(exclude.length ? ['--exclude', ...exclude] : []),
        ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
        ...(showAffectedDirectDependencies
          ? ['--show-affected-direct-dependencies']
          : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner, stdio: coanaStdio },
    )

    if (!fixCResult.ok) {
      logger.error(`Update failed for ${ghsaId}: ${getErrorCause(fixCResult)}`)
      continue
    }

    // Check for modified files after applying the fix.
    // eslint-disable-next-line no-await-in-loop
    const unstagedCResult = await gitUnstagedModifiedFiles(cwd)
    const modifiedFiles = unstagedCResult.ok
      ? unstagedCResult.data.filter(relPath =>
          scanBaseNames.has(path.basename(relPath)),
        )
      : []

    if (!modifiedFiles.length) {
      debug(`skip: no changes for ${ghsaId}`)
      continue
    }

    overallFixed = true

    const branch = getSocketFixBranchName(ghsaId)

    try {
      // Check if branch already exists.
      // eslint-disable-next-line no-await-in-loop
      if (await gitRemoteBranchExists(branch, cwd)) {
        debug(`skip: remote branch "${branch}" exists`)
        continue
      }

      debug(`pr: creating for ${ghsaId}`)

      const details = ghsaDetails.get(ghsaId)
      debug(`ghsa: ${ghsaId} details ${details ? 'found' : 'missing'}`)

      const pushed =
        // eslint-disable-next-line no-await-in-loop
        (await gitCreateBranch(branch, cwd)) &&
        // eslint-disable-next-line no-await-in-loop
        (await gitCheckoutBranch(branch, cwd)) &&
        // eslint-disable-next-line no-await-in-loop
        (await gitCommit(
          getSocketFixCommitMessage(ghsaId, details),
          modifiedFiles,
          {
            cwd,
            email: fixEnv.gitEmail,
            user: fixEnv.gitUser,
          },
        )) &&
        // eslint-disable-next-line no-await-in-loop
        (await gitPushBranch(branch, cwd))

      if (!pushed) {
        logger.warn(`Push failed for ${ghsaId}, skipping PR creation.`)
        // eslint-disable-next-line no-await-in-loop
        await gitResetAndClean(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitCheckoutBranch(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitDeleteBranch(branch, cwd)
        continue
      }

      // Set up git remote.
      if (!fixEnv.githubToken) {
        logger.error(
          'Cannot create pull request: SOCKET_CLI_GITHUB_TOKEN environment variable is not set.\n' +
            'Set SOCKET_CLI_GITHUB_TOKEN or GITHUB_TOKEN to enable PR creation.',
        )
        // eslint-disable-next-line no-await-in-loop
        await gitResetAndClean(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitCheckoutBranch(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitDeleteBranch(branch, cwd)
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await setGitRemoteGithubRepoUrl(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        fixEnv.githubToken,
        cwd,
      )

      // eslint-disable-next-line no-await-in-loop
      const prResponse = await openSocketFixPr(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        branch,
        // Single GHSA ID.
        [ghsaId],
        {
          baseBranch: fixEnv.baseBranch,
          cwd,
          ghsaDetails,
        },
      )

      if (prResponse) {
        const { data } = prResponse
        const prRef = `PR #${data.number}`

        logger.success(`Opened ${prRef} for ${ghsaId}.`)
        logger.info(`PR URL: ${data.html_url}`)

        if (autopilot) {
          logger.indent()
          spinner?.indent()
          // eslint-disable-next-line no-await-in-loop
          const { details, enabled } = await enablePrAutoMerge(data)
          if (enabled) {
            logger.info(`Auto-merge enabled for ${prRef}.`)
          } else {
            const message = `Failed to enable auto-merge for ${prRef}${
              details ? `:\n${details.map(d => ` - ${d}`).join('\n')}` : '.'
            }`
            logger.error(message)
          }
          logger.dedent()
          spinner?.dedent()
        }
      }

      // Reset back to base branch for next iteration.
      // eslint-disable-next-line no-await-in-loop
      await gitResetAndClean(branch, cwd)
      // eslint-disable-next-line no-await-in-loop
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    } catch (e) {
      logger.warn(
        `Unexpected condition: Push failed for ${ghsaId}, skipping PR creation.`,
      )
      debugDir(e)
      // eslint-disable-next-line no-await-in-loop
      await gitResetAndClean(fixEnv.baseBranch, cwd)
      // eslint-disable-next-line no-await-in-loop
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    }

    count += 1
    debug(`increment: count ${count}/${Math.min(adjustedLimit, ids.length)}`)
    if (count >= adjustedLimit) {
      break
    }
  }

  spinner?.stop()

  return {
    ok: true,
    data: { fixed: overallFixed },
  }
}
