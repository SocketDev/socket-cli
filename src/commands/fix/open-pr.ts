import {
  GraphqlResponseError,
  graphql as OctokitGraphql
} from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { Octokit } from '@octokit/rest'
import { codeBlock } from 'common-tags'

import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import { getSocketPullRequestBody, getSocketPullRequestTitle } from './git'
import constants from '../../constants'

import type { components } from '@octokit/openapi-types'
import type { OctokitResponse } from '@octokit/types'

type PullsCreateResponseData = components['schemas']['pull-request']

const { GITHUB_ACTIONS, GITHUB_REPOSITORY, SOCKET_SECURITY_GITHUB_PAT } =
  constants

type GitHubRepoInfo = {
  owner: string
  repo: string
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

let _octokitGraphql: typeof OctokitGraphql | undefined
export function getOctokitGraphql() {
  if (!_octokitGraphql) {
    _octokitGraphql = OctokitGraphql.defaults({
      headers: {
        // Lazily access constants.ENV[SOCKET_SECURITY_GITHUB_PAT].
        authorization: `token ${constants.ENV[SOCKET_SECURITY_GITHUB_PAT]}`
      }
    })
  }
  return _octokitGraphql
}

export async function doesPullRequestExistForBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<boolean> {
  const octokit = getOctokit()
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    state: 'open'
  })
  return prs.length > 0
}

export async function enableAutoMerge({
  node_id: prId,
  number: prNumber
}: PullsCreateResponseData): Promise<boolean> {
  const octokitGraphql = getOctokitGraphql()
  try {
    await octokitGraphql(
      codeBlock`
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
    return true
  } catch (e) {
    let message = `Failed to enable auto-merge for PR #${prNumber}`
    if (e instanceof GraphqlResponseError && e.errors) {
      const details = e.errors
        .map(({ message }) => ` - ${message.trim()}`)
        .join('\n')
      message += `:\n${details}`
    }
    logger.error(message)
    return false
  }
}

export function getGitHubEnvRepoInfo(): GitHubRepoInfo {
  // Lazily access constants.ENV[GITHUB_REPOSITORY].
  const ownerSlashRepo = constants.ENV[GITHUB_REPOSITORY]
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex === -1) {
    throw new Error('Missing GITHUB_REPOSITORY environment variable')
  }
  return {
    owner: ownerSlashRepo.slice(0, slashIndex),
    repo: ownerSlashRepo.slice(slashIndex + 1)
  }
}

export type OpenGitHubPullRequestOptions = {
  cwd?: string | undefined
  workspaceName?: string | undefined
}

export async function openGitHubPullRequest(
  owner: string,
  repo: string,
  baseBranch: string,
  branch: string,
  purl: string,
  newVersion: string,
  options?: OpenGitHubPullRequestOptions | undefined
): Promise<OctokitResponse<PullsCreateResponseData> | null> {
  const { cwd = process.cwd(), workspaceName } = {
    __proto__: null,
    ...options
  } as OpenGitHubPullRequestOptions
  // Lazily access constants.ENV[GITHUB_ACTIONS].
  if (constants.ENV[GITHUB_ACTIONS]) {
    // Lazily access constants.ENV[SOCKET_SECURITY_GITHUB_PAT].
    const pat = constants.ENV[SOCKET_SECURITY_GITHUB_PAT]
    if (!pat) {
      throw new Error('Missing SOCKET_SECURITY_GITHUB_PAT environment variable')
    }
    const url = `https://x-access-token:${pat}@github.com/${owner}/${repo}`
    await spawn('git', ['remote', 'set-url', 'origin', url], {
      cwd
    })
    const octokit = getOctokit()
    try {
      return await octokit.pulls.create({
        owner,
        repo,
        title: getSocketPullRequestTitle(purl, newVersion, workspaceName),
        head: branch,
        base: baseBranch,
        body: getSocketPullRequestBody(purl, newVersion, workspaceName)
      })
    } catch (e) {
      let message = `Failed to open pull request`
      if (e instanceof RequestError) {
        const restErrors = (e.response?.data as any)?.['errors']
        if (Array.isArray(restErrors)) {
          const details = restErrors
            .map(
              restErr =>
                `- ${restErr.message?.trim() ?? `${restErr.resource}.${restErr.field} (${restErr.code})`}`
            )
            .join('\n')
          message += `:\n${details}`
        }
      }
      logger.error(message)
      return null
    }
  }
  throw new Error('Missing GITHUB_ACTIONS environment variable')
}
