import { Octokit } from '@octokit/rest'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import constants from '../../constants'

import type { components } from '@octokit/openapi-types'
import type { OctokitResponse } from '@octokit/types'

type PullsCreateResponseData = components['schemas']['pull-request']

const {
  GITHUB_ACTIONS,
  GITHUB_REF_NAME,
  GITHUB_REPOSITORY,
  SOCKET_SECURITY_GITHUB_PAT
} = constants

async function branchExists(
  branch: string,
  cwd: string | undefined = process.cwd()
): Promise<boolean> {
  try {
    await spawn(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`],
      {
        cwd,
        stdio: 'ignore'
      }
    )
    return true
  } catch {}
  return false
}

async function checkoutBaseBranchIfAvailable(
  baseBranch: string,
  cwd: string | undefined = process.cwd()
) {
  try {
    const currentBranch = (
      await spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
    ).stdout.trim()
    if (currentBranch === baseBranch) {
      logger.info(`Already on ${baseBranch}`)
      return
    }
    logger.info(`Switching branch from ${currentBranch} to ${baseBranch}...`)
    await spawn('git', ['checkout', baseBranch], { cwd })
    logger.info(`Checked out ${baseBranch}`)
  } catch {
    logger.warn(`Could not switch to ${baseBranch}. Proceeding with HEAD.`)
  }
}

type GitHubRepoInfo = {
  owner: string
  repo: string
}

function getGitHubRepoInfo(): GitHubRepoInfo {
  // Lazily access constants.ENV[GITHUB_REPOSITORY].
  const ownerSlashRepo = constants.ENV[GITHUB_REPOSITORY]
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex === -1) {
    throw new Error('GITHUB_REPOSITORY environment variable not set')
  }
  return {
    owner: ownerSlashRepo.slice(0, slashIndex),
    repo: ownerSlashRepo.slice(slashIndex + 1)
  }
}

let _octokit: Octokit | undefined
function getOctokit() {
  if (_octokit === undefined) {
    _octokit = new Octokit({
      // Lazily access constants.ENV[SOCKET_SECURITY_GITHUB_PAT].
      auth: constants.ENV[SOCKET_SECURITY_GITHUB_PAT]
    })
  }
  return _octokit
}

export async function enableAutoMerge(
  prResponseData: PullsCreateResponseData
): Promise<void> {
  const octokit = getOctokit()
  const { node_id: prId, number: prNumber } = prResponseData

  try {
    await octokit.graphql(
      `
      mutation EnableAutoMerge($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId,
          mergeMethod: SQUASH
        }) {
          pullRequest {
            number
            autoMergeRequest {
              enabledAt
            }
          }
        }
      }
      `,
      {
        pullRequestId: prId
      }
    )
    logger.info(`Auto-merge enabled for PR #${prNumber}`)
  } catch (e) {
    logger.error(`Failed to enable auto-merge for PR #${prNumber}:`, e)
  }
}

export async function openGitHubPullRequest(
  name: string,
  targetVersion: string,
  cwd = process.cwd()
): Promise<OctokitResponse<PullsCreateResponseData>> {
  // Lazily access constants.ENV[GITHUB_ACTIONS].
  if (constants.ENV[GITHUB_ACTIONS]) {
    // Lazily access constants.ENV[SOCKET_SECURITY_GITHUB_PAT].
    const pat = constants.ENV[SOCKET_SECURITY_GITHUB_PAT]
    if (!pat) {
      throw new Error('Missing SOCKET_SECURITY_GITHUB_PAT environment variable')
    }
    const baseBranch =
      // Lazily access constants.ENV[GITHUB_REF_NAME].
      constants.ENV[GITHUB_REF_NAME] ??
      // GitHub defaults to branch name "main"
      // https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-branches#about-the-default-branch
      'main'
    const branch = `socket-fix-${name}-${targetVersion.replace(/\./g, '-')}`
    const commitMsg = `chore: upgrade ${name} to ${targetVersion}`
    const { owner, repo } = getGitHubRepoInfo()
    const url = `https://x-access-token:${pat}@github.com/${owner}/${repo}`

    await spawn('git', ['remote', 'set-url', 'origin', url], {
      cwd
    })

    if (await branchExists(branch, cwd)) {
      logger.warn(`Branch "${branch}" already exists. Skipping creation.`)
    } else {
      await checkoutBaseBranchIfAvailable(baseBranch, cwd)
      await spawn('git', ['checkout', '-b', branch], { cwd })
      await spawn('git', ['add', 'package.json', 'pnpm-lock.yaml'], { cwd })
      await spawn('git', ['commit', '-m', commitMsg], { cwd })
      await spawn('git', ['push', '--set-upstream', 'origin', branch], { cwd })
    }
    const octokit = getOctokit()
    return await octokit.pulls.create({
      owner,
      repo,
      title: commitMsg,
      head: branch,
      base: baseBranch,
      body: `[socket] Upgrade \`${name}\` to ${targetVersion}`
    })
  } else {
    throw new Error(
      'Unsupported CI platform or missing GITHUB_ACTIONS environment variable'
    )
  }
}
