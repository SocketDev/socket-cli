/** @fileoverview Coana reachability analysis integration for Socket CLI fix command. Executes Coana CLI to generate vulnerability fixes, manages CI environment detection, and coordinates fix application workflow. */

import path from 'node:path'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import {
  checkCiEnvVars,
  getCiEnvInstructions,
  getFixEnv,
} from './env-helpers.mts'
import { getSocketFixBranchName, getSocketFixCommitMessage } from './git.mts'
import { getSocketFixPrs, openSocketFixPr } from './pull-request.mts'
import { FLAG_DRY_RUN, GQL_PR_STATE_OPEN } from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana-spawn.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'
import { getErrorCause } from '../../utils/errors.mts'
import {
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitDeleteBranch,
  gitPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from '../../utils/git.mts'
import {
  enablePrAutoMerge,
  fetchGhsaDetails,
  setGitRemoteGithubRepoUrl,
} from '../../utils/github.mts'
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'

export async function coanaFix(
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const {
    applyFixes,
    autopilot,
    cwd,
    ghsas,
    glob,
    limit,
    minimumReleaseAge,
    orgSlug,
    outputFile,
    spinner,
  } = fixConfig

  const fixEnv = await getFixEnv()
  debugDir('inspect', { fixEnv })

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

    const fixCResult = await spawnCoana(
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
        ...(glob ? ['--glob', glob] : []),
        ...(!applyFixes ? [FLAG_DRY_RUN] : []),
        ...(outputFile ? ['--output-file', outputFile] : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner, stdio: 'inherit' },
    )

    spinner?.stop()

    return fixCResult.ok ? { ok: true, data: { fixed: true } } : fixCResult
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
        debugFn(
          'notice',
          `limit: adjusted from ${limit} to ${adjustedLimit} (${openPrCount} open Socket Fix ${pluralize('PR', openPrCount)}`,
        )
      }
    } catch (e) {
      debugFn('warn', 'Failed to count open PRs, using original limit')
      debugDir('error', e)
    }
  }

  const shouldSpawnCoana = adjustedLimit > 0

  let ids: string[] | undefined

  if (shouldSpawnCoana && isAll) {
    const foundCResult = await spawnCoana(
      [
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--manifests-tar-hash',
        tarHash,
        ...(fixConfig.rangeStyle
          ? ['--range-style', fixConfig.rangeStyle]
          : []),
        ...(minimumReleaseAge
          ? ['--minimum-release-age', minimumReleaseAge]
          : []),
        ...(glob ? ['--glob', glob] : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner },
    )
    if (foundCResult.ok) {
      const foundIds = cmdFlagValueToArray(
        /(?<=Vulnerabilities found:).*/.exec(foundCResult.data),
      )
      ids = foundIds.slice(0, adjustedLimit)
    }
  } else if (shouldSpawnCoana) {
    ids = ghsas.slice(0, adjustedLimit)
  }

  if (!ids?.length) {
    debugFn('notice', 'miss: no GHSA IDs to process')
  }

  if (!fixEnv.repoInfo) {
    debugFn('notice', 'miss: no repo info detected')
  }

  if (!ids?.length || !fixEnv.repoInfo) {
    spinner?.stop()
    return { ok: true, data: { fixed: false } }
  }

  debugFn('notice', `fetch: ${ids.length} GHSA details for ${joinAnd(ids)}`)

  const ghsaDetails = await fetchGhsaDetails(ids)
  const scanBaseNames = new Set(scanFilepaths.map(p => path.basename(p)))

  debugFn('notice', `found: ${ghsaDetails.size} GHSA details`)

  let count = 0
  let overallFixed = false

  // Process each GHSA ID individually.
  ghsaLoop: for (let i = 0, { length } = ids; i < length; i += 1) {
    const ghsaId = ids[i]!
    debugFn('notice', `check: ${ghsaId}`)

    // Apply fix for single GHSA ID.
    // eslint-disable-next-line no-await-in-loop
    const fixCResult = await spawnCoana(
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
        ...(glob ? ['--glob', glob] : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner, stdio: 'inherit' },
    )

    if (!fixCResult.ok) {
      logger.error(`Update failed for ${ghsaId}: ${getErrorCause(fixCResult)}`)
      continue ghsaLoop
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
      debugFn('notice', `skip: no changes for ${ghsaId}`)
      continue ghsaLoop
    }

    overallFixed = true

    const branch = getSocketFixBranchName(ghsaId)

    try {
      // Check if branch already exists.
      // eslint-disable-next-line no-await-in-loop
      if (await gitRemoteBranchExists(branch, cwd)) {
        debugFn('notice', `skip: remote branch "${branch}" exists`)
        continue ghsaLoop
      }

      debugFn('notice', `pr: creating for ${ghsaId}`)

      const details = ghsaDetails.get(ghsaId)
      debugFn(
        'notice',
        `ghsa: ${ghsaId} details ${details ? 'found' : 'missing'}`,
      )

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
        continue ghsaLoop
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
        continue ghsaLoop
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
      debugDir('error', e)
      // eslint-disable-next-line no-await-in-loop
      await gitResetAndClean(fixEnv.baseBranch, cwd)
      // eslint-disable-next-line no-await-in-loop
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    }

    count += 1
    debugFn(
      'notice',
      `increment: count ${count}/${Math.min(adjustedLimit, ids.length)}`,
    )
    if (count >= adjustedLimit) {
      break ghsaLoop
    }
  }

  spinner?.stop()

  return {
    ok: true,
    data: { fixed: overallFixed },
  }
}
