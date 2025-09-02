import path from 'node:path'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { getFixEnv } from './fix-env-helpers.mts'
import {
  enablePrAutoMerge,
  fetchGhsaDetails,
  openCoanaPr,
  setGitRemoteGithubRepoUrl,
} from './pull-request.mts'
import { handleApiCall } from '../../utils/api.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana.mts'
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
import { getPackageFilesForScan } from '../../utils/path-resolve.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { fetchSupportedScanFileNames } from '../scan/fetch-supported-scan-file-names.mts'

import type { FixConfig } from './agent-fix.mts'
import type { CResult } from '../../types.mts'

export async function coanaFix(
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { autoMerge, cwd, ghsas, limit, orgSlug, spinner } = fixConfig

  const fixEnv = await getFixEnv()
  debugDir('inspect', { fixEnv })

  spinner?.start()

  const sockSdkCResult = await setupSdk()
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }

  const sockSdk = sockSdkCResult.data

  const supportedFilesCResult = await fetchSupportedScanFileNames()
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
      desc: 'upload manifests',
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
    ghsas.length === 1 && (ghsas[0] === 'all' || ghsas[0] === 'auto')

  const shouldOpenPrs = fixEnv.isCi && fixEnv.repoInfo

  if (!shouldOpenPrs) {
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
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner },
    )
    spinner?.stop()
    return fixCResult.ok ? { ok: true, data: { fixed: true } } : fixCResult
  }

  let ids: string[] | undefined
  if (isAll) {
    const foundCResult = await spawnCoana(
      [
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--manifests-tar-hash',
        tarHash,
        ...(fixConfig.rangeStyle
          ? ['--range-style', fixConfig.rangeStyle]
          : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner },
    )
    if (foundCResult.ok) {
      const foundIds = cmdFlagValueToArray(
        /(?<=Vulnerabilities found:).*/.exec(foundCResult.data),
      )
      ids = foundIds.slice(0, limit)
    }
  } else {
    ids = ghsas.slice(0, limit)
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

  // Process each GHSA ID individually, similar to npm-fix/pnpm-fix.
  ghsaLoop: for (let i = 0, { length } = ids; i < length; i += 1) {
    const id = ids[i]!
    debugFn('notice', `check: ${id}`)

    // Apply fix for single GHSA ID.
    // eslint-disable-next-line no-await-in-loop
    const fixCResult = await spawnCoana(
      [
        'compute-fixes-and-upgrade-purls',
        cwd,
        '--manifests-tar-hash',
        tarHash,
        '--apply-fixes-to',
        id,
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { cwd, spinner },
    )

    if (!fixCResult.ok) {
      logger.error(
        `Update failed for ${id}: ${fixCResult.message || 'Unknown error'}`,
      )
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
      debugFn('notice', `skip: no changes for ${id}`)
      continue ghsaLoop
    }

    overallFixed = true

    const branch = `socket/fix/${id}`

    try {
      // Check if branch already exists.
      // eslint-disable-next-line no-await-in-loop
      if (await gitRemoteBranchExists(branch, cwd)) {
        debugFn('notice', `skip: remote branch "${branch}" exists`)
        continue ghsaLoop
      }

      debugFn('notice', `pr: creating for ${id}`)

      const details = ghsaDetails.get(id)
      const summary = details?.summary
      debugFn('notice', `ghsa: ${id} details ${details ? 'found' : 'missing'}`)

      const pushed =
        // eslint-disable-next-line no-await-in-loop
        (await gitCreateBranch(branch, cwd)) &&
        // eslint-disable-next-line no-await-in-loop
        (await gitCheckoutBranch(branch, cwd)) &&
        // eslint-disable-next-line no-await-in-loop
        (await gitCommit(
          `fix: ${id}${summary ? ` - ${summary}` : ''}`,
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
        logger.warn(`Push failed for ${id}, skipping PR creation.`)
        // eslint-disable-next-line no-await-in-loop
        await gitResetAndClean(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitCheckoutBranch(fixEnv.baseBranch, cwd)
        // eslint-disable-next-line no-await-in-loop
        await gitDeleteBranch(branch, cwd)
        continue ghsaLoop
      }

      // Set up git remote.
      // eslint-disable-next-line no-await-in-loop
      await setGitRemoteGithubRepoUrl(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        fixEnv.githubToken!,
        cwd,
      )

      // eslint-disable-next-line no-await-in-loop
      const prResponse = await openCoanaPr(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        branch,
        // Single GHSA ID.
        [id],
        {
          baseBranch: fixEnv.baseBranch,
          cwd,
          ghsaDetails,
        },
      )

      if (prResponse) {
        const { data } = prResponse
        const prRef = `PR #${data.number}`
        logger.success(`Opened ${prRef} for ${id}.`)

        if (autoMerge) {
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
        `Unexpected condition: Push failed for ${id}, skipping PR creation.`,
      )
      debugDir('inspect', { error: e })
      // eslint-disable-next-line no-await-in-loop
      await gitResetAndClean(fixEnv.baseBranch, cwd)
      // eslint-disable-next-line no-await-in-loop
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    }

    count += 1
    debugFn(
      'notice',
      `increment: count ${count}/${Math.min(limit, ids.length)}`,
    )
    if (count >= limit) {
      break ghsaLoop
    }
  }

  spinner?.stop()

  return {
    ok: true,
    data: { fixed: overallFixed },
  }
}
