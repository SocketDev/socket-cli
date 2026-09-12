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

export async function cleanupBranchesAfterUnexpectedError(
  branch: string,
  cwd: string,
): Promise<void> {
  try {
    const remoteBranchExists = await gitRemoteBranchExists(branch, cwd)
    await cleanupErrorBranches(branch, cwd, remoteBranchExists)
  } catch (e) {
    debug('pr: failed to cleanup branches during exception cleanup')
    debugDir(e)
  }
}

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
    excludePaths,
    include,
    minimumReleaseAge,
    packageManagers,
    showAffectedDirectDependencies,
    spinner,
  } = fixConfig
  // --exclude-paths is the canonical path exclusion; forward it to coana's
  // workspace filter alongside the legacy --exclude entries so a matched path
  // is skipped consistently across manifest upload and fix application.
  const coanaExcludePatterns = [...exclude, ...excludePaths]
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

  function buildCoanaArgs(ghsaId: string): string[] {
    return [
      ...coanaSilenceArgs,
      'compute-fixes-and-upgrade-purls',
      cwd,
      '--manifests-tar-hash',
      tarHash,
      '--apply-fixes-to',
      ghsaId,
      ...(fixConfig.rangeStyle ? ['--range-style', fixConfig.rangeStyle] : []),
      ...(minimumReleaseAge
        ? ['--minimum-release-age', minimumReleaseAge]
        : []),
      ...(include.length ? ['--include', ...include] : []),
      ...(coanaExcludePatterns.length
        ? ['--exclude', ...coanaExcludePatterns]
        : []),
      ...(packageManagers.length
        ? ['--package-managers', ...packageManagers]
        : []),
      ...(ecosystems.length ? ['--purl-types', ...ecosystems] : []),
      ...(debugFlag ? ['--debug'] : []),
      ...(disableExternalToolChecks ? ['--disable-external-tool-checks'] : []),
      ...(disableMajorUpdates ? ['--disable-major-updates'] : []),
      ...(showAffectedDirectDependencies
        ? ['--show-affected-direct-dependencies']
        : []),
      ...fixConfig.unknownFlags,
    ]
  }

  async function computeModifiedFiles(
    ghsaId: string,
  ): Promise<string[] | undefined> {
    const fixCResult = await spawnCoanaDlx(buildCoanaArgs(ghsaId), {
      orgSlug: fixConfig.orgSlug,
      coanaVersion,
      cwd,
      spinner,
      stdio: coanaStdio,
    })
    if (!fixCResult.ok) {
      logger.error(`Update failed for ${ghsaId}: ${getErrorCause(fixCResult)}`)
      return undefined
    }
    const unstagedCResult = await gitUnstagedModifiedFiles(cwd)
    const modifiedFiles = unstagedCResult.ok
      ? unstagedCResult.data.filter(relPath =>
          scanBaseNames.has(path.basename(relPath)),
        )
      : []
    if (!modifiedFiles.length) {
      debug(`skip: no changes for ${ghsaId}`)
      return undefined
    }
    return modifiedFiles
  }

  async function closeSupersededPrs(ghsaId: string): Promise<void> {
    const existingPrs = await getSocketFixPrs(
      fixEnv.repoInfo!.owner,
      fixEnv.repoInfo!.repo,
      { ghsaId, states: GQL_PR_STATE_OPEN },
    )
    if (existingPrs.length) {
      debug(`pr: found ${existingPrs.length} existing open PRs for ${ghsaId}`)
    }
    for (let i = 0, { length } = existingPrs; i < length; i += 1) {
      const pr = existingPrs[i]!
      try {
        const octokit = getOctokit()
        await octokit.issues.createComment({
          owner: fixEnv.repoInfo!.owner,
          repo: fixEnv.repoInfo!.repo,
          issue_number: pr.number,
          body: 'Closing this PR as a newer fix is available.',
        })
        await octokit.pulls.update({
          owner: fixEnv.repoInfo!.owner,
          repo: fixEnv.repoInfo!.repo,
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

  async function hasOpenPr(ghsaId: string): Promise<boolean> {
    const existingPrs = await getSocketFixPrs(
      fixEnv.repoInfo!.owner,
      fixEnv.repoInfo!.repo,
      { ghsaId, states: GQL_PR_STATE_OPEN },
    )
    const prNum = existingPrs[0]?.number
    if (prNum) {
      logger.info(`PR #${prNum} already exists for ${ghsaId}, skipping.`)
      debug(`skip: open PR #${prNum} exists for ${ghsaId}`)
    }
    return existingPrs.length > 0
  }

  async function pushFixBranch(
    branch: string,
    ghsaId: string,
    modifiedFiles: string[],
  ): Promise<boolean> {
    if (await gitRemoteBranchExists(branch, cwd)) {
      const shouldContinue = await cleanupStaleBranch(branch, ghsaId, cwd)
      if (!shouldContinue) {
        return false
      }
    }
    if (!fixEnv.githubToken) {
      logger.error(
        'Cannot create pull request: SOCKET_CLI_GITHUB_TOKEN environment variable is not set.\n' +
          'Set SOCKET_CLI_GITHUB_TOKEN or GITHUB_TOKEN to enable PR creation.',
      )
      debug(`skip: missing GitHub token for ${ghsaId}`)
      return false
    }
    const details = ghsaDetails.get(ghsaId)
    debug(`pr: creating for ${ghsaId}`)
    debug(`ghsa: ${ghsaId} details ${details ? 'found' : 'missing'}`)
    const pushed =
      (await gitCreateBranch(branch, cwd)) &&
      (await gitCheckoutBranch(branch, cwd)) &&
      (await gitCommit(
        getSocketFixCommitMessage(ghsaId, details),
        modifiedFiles,
        { cwd, email: fixEnv.gitEmail, user: fixEnv.gitUser },
      )) &&
      (await gitPushBranch(branch, cwd))
    if (pushed) {
      return true
    }
    logger.warn(`Push failed for ${ghsaId}, skipping PR creation.`)
    await cleanupBranchesAfterUnexpectedError(branch, cwd)
    await resetToBaseBranch()
    return false
  }

  async function resetToBaseBranch(): Promise<void> {
    await gitResetAndClean(fixEnv.baseBranch, cwd)
    await gitCheckoutBranch(fixEnv.baseBranch, cwd)
  }

  async function recordOpenedPr(
    branch: string,
    ghsaId: string,
    data: { html_url: string; number: number },
  ): Promise<void> {
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
    await markGhsaFixed(cwd, ghsaId, data.number, branch)
    if (autopilot) {
      logger.indent()
      spinner?.indent()
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
    await cleanupSuccessfulPrLocalBranch(branch, cwd)
  }

  async function handlePrFailure(
    branch: string,
    ghsaId: string,
    result: Exclude<Awaited<ReturnType<typeof openSocketFixPr>>, { ok: true }>,
  ): Promise<void> {
    if (result.reason === 'already_exists') {
      logger.info(
        `PR already exists for ${ghsaId} (this should not happen due to earlier check).`,
      )
      return
    }
    if (result.reason === 'validation_error') {
      logger.error(`Failed to create PR for ${ghsaId}:`)
      logger.error(result.details)
    } else if (result.reason === 'permission_denied') {
      logger.error(
        `Failed to create PR for ${ghsaId}: Permission denied. Check SOCKET_CLI_GITHUB_TOKEN permissions.`,
      )
    } else if (result.reason === 'network_error') {
      logger.error(
        `Failed to create PR for ${ghsaId}: Network error. Please try again.`,
      )
    } else {
      logger.error(`Failed to create PR for ${ghsaId}: ${result.error.message}`)
    }
    await cleanupFailedPrBranches(branch, cwd)
  }

  async function createFixPr(branch: string, ghsaId: string): Promise<void> {
    await setGitRemoteGithubRepoUrl(
      fixEnv.repoInfo!.owner,
      fixEnv.repoInfo!.repo,
      fixEnv.githubToken!,
      cwd,
    )
    const result = await openSocketFixPr(
      fixEnv.repoInfo!.owner,
      fixEnv.repoInfo!.repo,
      branch,
      [ghsaId],
      { baseBranch: fixEnv.baseBranch, cwd, ghsaDetails },
    )
    if (result.ok) {
      await recordOpenedPr(branch, ghsaId, result.pr.data)
    } else {
      await handlePrFailure(branch, ghsaId, result)
    }
  }

  async function processGhsa(ghsaId: string): Promise<boolean> {
    debug(`check: ${ghsaId}`)
    const modifiedFiles = await computeModifiedFiles(ghsaId)
    if (!modifiedFiles) {
      return false
    }
    overallFixed = true
    const branch = getSocketFixBranchName(ghsaId)
    try {
      await closeSupersededPrs(ghsaId)
      if (await hasOpenPr(ghsaId)) {
        return false
      }
      if (!(await pushFixBranch(branch, ghsaId, modifiedFiles))) {
        return false
      }
      await createFixPr(branch, ghsaId)
      await resetToBaseBranch()
      return true
    } catch (e) {
      logger.warn(
        `Unexpected condition: Push failed for ${ghsaId}, skipping PR creation.`,
      )
      debugDir(e)
      await cleanupBranchesAfterUnexpectedError(branch, cwd)
      await resetToBaseBranch()
      return true
    }
  }

  for (let i = 0, { length } = unprocessedIds; i < length; i += 1) {
    const ghsaId = unprocessedIds[i]!
    if (!(await processGhsa(ghsaId))) {
      continue
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
