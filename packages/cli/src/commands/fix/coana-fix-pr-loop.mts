import path from 'node:path'

import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  cleanupErrorBranches,
  cleanupFailedPrBranches,
  cleanupStaleBranch,
  cleanupSuccessfulPrLocalBranch,
} from './branch-cleanup.mts'
import { markGhsaFixed } from './ghsa-tracker.mts'
import { getSocketFixBranchName, getSocketFixCommitMessage } from './git.mts'
import { logPrEvent } from './pr-lifecycle-logger.mts'
import { getSocketFixPrs, openSocketFixPr } from './pull-request.mts'
import { GQL_PR_STATE_OPEN } from '../../constants/github.mts'
import { getErrorCause } from '../../util/error/errors.mjs'
import {
  enablePrAutoMerge,
  getOctokit,
  setGitRemoteGithubRepoUrl,
} from '../../util/git/github.mts'
import {
  gitCheckoutBranch,
  gitCommit,
  gitCreateBranch,
  gitPushBranch,
  gitRemoteBranchExists,
  gitResetAndClean,
  gitUnstagedModifiedFiles,
} from '../../util/git/operations.mjs'
import { spawnCoanaDlx } from '../../util/dlx/spawn.mjs'

import type { GhsaFixResult } from './coana-fix-ci.mts'
import type { FixEnv } from './env-helpers.mts'
import type { FixConfig } from './types.mts'
import type { CResult } from '../../types.mts'
import type { GhsaDetails } from '../../util/git/github.mts'
const logger = getDefaultLogger()

export async function runGhsaFixLoop(
  fixConfig: FixConfig,
  context: {
    adjustedLimit: number
    coanaSilenceArgs: string[]
    coanaStdio: 'ignore' | 'inherit'
    fixEnv: FixEnv
    ghsaDetails: Map<string, GhsaDetails>
    scanBaseNames: Set<string>
    tarHash: string
    unprocessedIds: string[]
  },
): Promise<CResult<{ fixedAll: boolean; ghsaDetails: GhsaFixResult[] }>> {
  const {
    autopilot,
    coanaVersion,
    cwd,
    debug: debugFlag,
    disableExternalToolChecks,
    disableMajorUpdates,
    ecosystems,
    exclude,
    include,
    minimumReleaseAge,
    showAffectedDirectDependencies,
    spinner,
  } = fixConfig
  const {
    adjustedLimit,
    coanaSilenceArgs,
    coanaStdio,
    fixEnv,
    ghsaDetails,
    scanBaseNames,
    tarHash,
    unprocessedIds,
  } = context

  /* c8 ignore start -- defensive: callers only invoke runGhsaFixLoop after confirming fixEnv.repoInfo is truthy. */
  if (!fixEnv.repoInfo) {
    spinner?.stop()
    return { ok: true, data: { fixedAll: false, ghsaDetails: [] } }
  }
  /* c8 ignore stop */

  let count = 0
  let overallFixed = false
  const ghsaFixResults: GhsaFixResult[] = []

  // Process each GHSA ID individually.
  // Use unprocessedIds instead of ids to skip already-fixed GHSAs.
  for (let i = 0, { length } = unprocessedIds; i < length; i += 1) {
    const ghsaId = unprocessedIds[i]!
    debug(`check: ${ghsaId}`)

    // Apply fix for single GHSA ID.
    const fixCResult = await spawnCoanaDlx(
      [
        ...coanaSilenceArgs,
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
        ...(ecosystems.length ? ['--purl-types', ...ecosystems] : []),
        ...(debugFlag ? ['--debug'] : []),
        ...(disableExternalToolChecks
          ? ['--disable-external-tool-checks']
          : []),
        ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
        ...(showAffectedDirectDependencies
          ? ['--show-affected-direct-dependencies']
          : []),
        ...fixConfig.unknownFlags,
      ],
      fixConfig.orgSlug,
      { coanaVersion, cwd, spinner, stdio: coanaStdio },
    )

    if (!fixCResult.ok) {
      logger.error(`Update failed for ${ghsaId}: ${getErrorCause(fixCResult)}`)
      continue
    }

    // Check for modified files after applying the fix.
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
      // Check for existing open PRs for this GHSA before creating a new one.
      const existingPrs = await getSocketFixPrs(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        {
          ghsaId,
          states: GQL_PR_STATE_OPEN,
        },
      )

      if (existingPrs.length) {
        debug(`pr: found ${existingPrs.length} existing open PRs for ${ghsaId}`)

        // Close outdated PRs with explanatory comment.
        for (
          let j = 0, { length: prLength } = existingPrs;
          j < prLength;
          j += 1
        ) {
          const pr = existingPrs[j]!
          try {
            const octokit = getOctokit()
            await octokit.issues.createComment({
              owner: fixEnv.repoInfo.owner,
              repo: fixEnv.repoInfo.repo,
              issue_number: pr.number,
              body: 'Closing this PR as a newer fix is available.',
            })

            await octokit.pulls.update({
              owner: fixEnv.repoInfo.owner,
              repo: fixEnv.repoInfo.repo,
              pull_number: pr.number,
              state: 'closed',
            })

            debug(`pr: closed superseded PR #${pr.number} for ${ghsaId}`)
            logPrEvent('superseded', pr.number, ghsaId)
          } catch (e) {
            debug(`pr: failed to close superseded PR #${pr.number}`)
            debugDir(e)
          }
        }
      }

      // Check if an open PR already exists for this GHSA.
      const existingOpenPrs = await getSocketFixPrs(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        {
          ghsaId,
          states: GQL_PR_STATE_OPEN,
        },
      )

      if (existingOpenPrs.length > 0) {
        const [firstPr] = existingOpenPrs
        const prNum = firstPr?.number
        if (prNum) {
          logger.info(`PR #${prNum} already exists for ${ghsaId}, skipping.`)
          debug(`skip: open PR #${prNum} exists for ${ghsaId}`)
        }
        continue
      }

      // If branch exists but no open PR, delete the stale branch.
      // This handles cases where PR creation failed but branch was pushed.
      if (await gitRemoteBranchExists(branch, cwd)) {
        const shouldContinue = await cleanupStaleBranch(branch, ghsaId, cwd)
        if (!shouldContinue) {
          continue
        }
      }

      // Check for GitHub token before doing any git operations.
      if (!fixEnv.githubToken) {
        logger.error(
          'Cannot create pull request: SOCKET_CLI_GITHUB_TOKEN environment variable is not set.\n' +
            'Set SOCKET_CLI_GITHUB_TOKEN or GITHUB_TOKEN to enable PR creation.',
        )
        debug(`skip: missing GitHub token for ${ghsaId}`)
        continue
      }

      debug(`pr: creating for ${ghsaId}`)

      const details = ghsaDetails.get(ghsaId)
      debug(`ghsa: ${ghsaId} details ${details ? 'found' : 'missing'}`)

      const pushed =
        (await gitCreateBranch(branch, cwd)) &&
        (await gitCheckoutBranch(branch, cwd)) &&
        (await gitCommit(
          getSocketFixCommitMessage(ghsaId, details),
          modifiedFiles,
          {
            cwd,
            email: fixEnv.gitEmail,
            user: fixEnv.gitUser,
          },
        )) &&
        (await gitPushBranch(branch, cwd))

      if (!pushed) {
        logger.warn(`Push failed for ${ghsaId}, skipping PR creation.`)
        // Clean up branches after push failure.
        try {
          const remoteBranchExists = await gitRemoteBranchExists(branch, cwd)
          await cleanupErrorBranches(branch, cwd, remoteBranchExists)
        } catch (e) {
          debug('pr: failed to cleanup branches after push failure')
          debugDir(e)
        }
        // Clean up local state.
        await gitResetAndClean(fixEnv.baseBranch, cwd)
        await gitCheckoutBranch(fixEnv.baseBranch, cwd)
        continue
      }

      // Set up git remote.
      await setGitRemoteGithubRepoUrl(
        fixEnv.repoInfo.owner,
        fixEnv.repoInfo.repo,
        fixEnv.githubToken,
        cwd,
      )

      const prResult = await openSocketFixPr(
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

      if (prResult.ok) {
        const { data } = prResult.pr
        const prRef = `PR #${data.number}`

        logger.success(`Opened ${prRef} for ${ghsaId}.`)
        logger.info(`PR URL: ${data.html_url}`)
        logPrEvent('created', data.number, ghsaId, data.html_url)

        ghsaFixResults.push({
          fixed: true,
          ghsaId,
          pullRequestLink: data.html_url,
          pullRequestNumber: data.number,
        })

        // Mark GHSA as fixed in tracker.
        await markGhsaFixed(cwd, ghsaId, data.number, branch)

        if (autopilot) {
          logger.indent()
          spinner?.indent()
          const { details: autoMergeDetails, enabled } =
            await enablePrAutoMerge(data)
          if (enabled) {
            logger.info(`Auto-merge enabled for ${prRef}.`)
          } else {
            const message = `Failed to enable auto-merge for ${prRef}${
              autoMergeDetails
                ? `:\n${autoMergeDetails.map(d => ` - ${d}`).join('\n')}`
                : '.'
            }`
            logger.error(message)
          }
          logger.dedent()
          spinner?.dedent()
        }

        // Clean up local branch only - keep remote branch for PR merge.
        await cleanupSuccessfulPrLocalBranch(branch, cwd)
      } else {
        // Handle PR creation failures.
        if (prResult.reason === 'already_exists') {
          logger.info(
            `PR already exists for ${ghsaId} (this should not happen due to earlier check).`,
          )
          // Don't delete branch - PR exists and needs it.
        } else if (prResult.reason === 'validation_error') {
          logger.error(
            `Failed to create PR for ${ghsaId}:\n${prResult.details}`,
          )
          await cleanupFailedPrBranches(branch, cwd)
        } else if (prResult.reason === 'permission_denied') {
          logger.error(
            `Failed to create PR for ${ghsaId}: Permission denied. Check SOCKET_CLI_GITHUB_TOKEN permissions.`,
          )
          await cleanupFailedPrBranches(branch, cwd)
        } else if (prResult.reason === 'network_error') {
          logger.error(
            `Failed to create PR for ${ghsaId}: Network error. Please try again.`,
          )
          await cleanupFailedPrBranches(branch, cwd)
        } else {
          logger.error(
            `Failed to create PR for ${ghsaId}: ${prResult.error.message}`,
          )
          await cleanupFailedPrBranches(branch, cwd)
        }
      }

      // Reset back to base branch for next iteration.
      await gitResetAndClean(fixEnv.baseBranch, cwd)
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    } catch (e) {
      logger.warn(
        `Unexpected condition: Push failed for ${ghsaId}, skipping PR creation.`,
      )
      debugDir(e)
      // Clean up branches after unexpected error.
      try {
        const remoteBranchExists = await gitRemoteBranchExists(branch, cwd)
        await cleanupErrorBranches(branch, cwd, remoteBranchExists)
      } catch (e) {
        debug('pr: failed to cleanup branches during exception cleanup')
        debugDir(e)
      }
      // Clean up local state.
      await gitResetAndClean(fixEnv.baseBranch, cwd)
      await gitCheckoutBranch(fixEnv.baseBranch, cwd)
    }

    count += 1
    debug(
      `increment: count ${count}/${Math.min(adjustedLimit, unprocessedIds.length)}`,
    )
    if (count >= adjustedLimit) {
      break
    }
  }

  spinner?.stop()

  return {
    ok: true,
    data: { fixedAll: overallFixed, ghsaDetails: ghsaFixResults },
  }
}
