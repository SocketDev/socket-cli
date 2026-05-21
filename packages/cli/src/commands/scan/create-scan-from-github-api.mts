/**
 * GitHub API helpers for `socket scan github`.
 *
 * Extracted from create-scan-from-github.mts to keep that file under the
 * 1000-line File-size cap. These wrap octokit.repos.* / .git.* /
 * .repos.listCommits with the project's CResult contract and friendly error
 * messages for empty repos / missing default branch.
 */

import { debugDir } from '@socketsecurity/lib-stable/debug'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { getOctokit, withGitHubRetry } from '../../util/git/github.mts'

import type { CResult } from '../../types.mts'

const logger = getDefaultLogger()

/**
 * Fetch the latest commit on the given branch (SHA, message, committer).
 */
export async function getLastCommitDetails({
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
    /* c8 ignore start - withGitHubRetry mock returns cached value; the inner factory only runs on cache miss */
    async () => {
      const { data } = await octokit.repos.listCommits({
        owner: orgGithub,
        repo: repoSlug,
        sha: defaultBranch,
        per_page: 1,
      })
      return data
    },
    /* c8 ignore stop */
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

  const [lastCommit] = commits
  const lastCommitSha = lastCommit?.sha

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
  const authorName = lastCommit?.commit?.author?.name
  const committerName = lastCommit?.commit?.committer?.name
  const lastCommitter = authorName || committerName
  const lastCommitMessage = lastCommit?.commit?.message || ''

  return { ok: true, data: { lastCommitMessage, lastCommitSha, lastCommitter } }
}

/**
 * Fetch the recursive file tree of a branch — returns a flat list of blob
 * paths.
 *
 * Treats a `GitHub resource not found` error as an empty repo (returns []),
 * since the most common cause is a freshly-created repo with no commits.
 */
export async function getRepoBranchTree({
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
    /* c8 ignore start - withGitHubRetry mock returns cached value; the inner factory only runs on cache miss */
    async () => {
      const { data } = await octokit.git.getTree({
        owner: orgGithub,
        repo: repoSlug,
        tree_sha: defaultBranch,
        recursive: 'true',
      })
      return data
    },
    /* c8 ignore stop */
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
    .map(obj => obj.path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0)

  return { ok: true, data: files }
}

/**
 * Fetch repo metadata (default branch, plus the raw repo details payload).
 */
export async function getRepoDetails({
  orgGithub,
  repoSlug,
}: {
  orgGithub: string
  repoSlug: string
  githubApiUrl: string
  githubToken: string
}): Promise<CResult<{ defaultBranch: string; repoDetails: unknown }>> {
  const octokit = getOctokit()

  const result = await withGitHubRetry(
    /* c8 ignore start - withGitHubRetry mock returns cached value; the inner factory only runs on cache miss */
    async () => {
      const { data } = await octokit.repos.get({
        owner: orgGithub,
        repo: repoSlug,
      })
      return data
    },
    /* c8 ignore stop */
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
