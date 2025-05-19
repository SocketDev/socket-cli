import { existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'

import {
  GraphqlResponseError,
  graphql as OctokitGraphql
} from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { Octokit } from '@octokit/rest'
import semver from 'semver'

import { readJson, writeJson } from '@socketsecurity/registry/lib/fs'
import { logger } from '@socketsecurity/registry/lib/logger'
import { spawn } from '@socketsecurity/registry/lib/spawn'

import {
  getSocketPrTitlePattern,
  getSocketPullRequestBody,
  getSocketPullRequestTitle
} from './git.mts'
import constants from '../../constants.mts'

import type { components } from '@octokit/openapi-types'
import type { OctokitResponse } from '@octokit/types'
import type { JsonContent } from '@socketsecurity/registry/lib/fs'

let _octokit: Octokit | undefined
function getOctokit() {
  if (_octokit === undefined) {
    _octokit = new Octokit({
      // Lazily access constants.ENV properties.
      auth:
        constants.ENV.SOCKET_SECURITY_GITHUB_PAT || constants.ENV.GITHUB_TOKEN
    })
  }
  return _octokit
}

let _octokitGraphql: typeof OctokitGraphql | undefined
export function getOctokitGraphql() {
  if (!_octokitGraphql) {
    _octokitGraphql = OctokitGraphql.defaults({
      headers: {
        // Lazily access constants.ENV properties.
        authorization: `token ${constants.ENV.SOCKET_SECURITY_GITHUB_PAT || constants.ENV.GITHUB_TOKEN}`
      }
    })
  }
  return _octokitGraphql
}

export async function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number | undefined
): Promise<T> {
  // Optionally disable cache.
  if (constants.ENV.DISABLE_GITHUB_CACHE) {
    return await fetcher()
  }
  let data = (await readCache(key, ttlMs)) as T
  if (!data) {
    data = await fetcher()
    await writeCache(key, data as JsonContent)
  }
  return data
}

async function readCache(
  key: string,
  // 5 minute in milliseconds time to live (TTL).
  ttlMs = 5 * 60 * 1000
): Promise<JsonContent | null> {
  // Lazily access constants.githubCachePath.
  const cacheJsonPath = path.join(constants.githubCachePath, `${key}.json`)
  try {
    const stat = statSync(cacheJsonPath)
    const isExpired = Date.now() - stat.mtimeMs > ttlMs
    if (!isExpired) {
      return await readJson(cacheJsonPath)
    }
  } catch {}
  return null
}

async function writeCache(key: string, data: JsonContent): Promise<void> {
  // Lazily access constants.githubCachePath.
  const { githubCachePath } = constants
  const cacheJsonPath = path.join(githubCachePath, `${key}.json`)
  if (!existsSync(githubCachePath)) {
    await fs.mkdir(githubCachePath, { recursive: true })
  }
  await writeJson(cacheJsonPath, data as JsonContent)
}

export type Pr = components['schemas']['pull-request']

export type CleanupPrsOptions = {
  workspaceName?: string | undefined
}

export async function cleanupOpenPrs(
  owner: string,
  repo: string,
  purl: string,
  newVersion: string,
  options?: CleanupPrsOptions | undefined
) {
  const { workspaceName } = { __proto__: null, ...options } as CleanupPrsOptions
  const octokit = getOctokit()
  const octokitGraphql = getOctokitGraphql()
  const titlePattern = getSocketPrTitlePattern(purl, workspaceName)

  type PrMatch = {
    apiType: 'graphql' | 'rest'
    cacheKey: string
    data: any
    entry: any
    index: number
    parent: any[]
    props: any
  }
  type GqlPrNode = {
    baseRefName: string
    headRefName: string
    mergeable: string
    number: number
    title: string
  }

  const prMatches: PrMatch[] = []
  try {
    // Optimistically fetch only the first 50 open PRs using GraphQL to minimize
    // API quota usage. Fallback to REST if no matching PRs are found.
    const gqlCacheKey = `${repo}-pr-graphql-snapshot`
    const gqlResp = await cacheFetch(gqlCacheKey, () =>
      octokitGraphql(
        `
          query($owner: String!, $repo: String!) {
            repository(owner: $owner, name: $repo) {
              pullRequests(first: 50, states: OPEN, orderBy: {field: CREATED_AT, direction: DESC}) {
                nodes {
                  number
                  title
                  mergeStateStatus
                  headRefName
                  baseRefName
                }
              }
            }
          }
          `,
        { owner, repo }
      )
    )
    const nodes: GqlPrNode[] = (gqlResp as any)?.repository?.pullRequests?.nodes
    if (nodes) {
      for (let i = 0, { length } = nodes; i < length; i += 1) {
        const node = nodes[i]!
        if (titlePattern.test(node.title)) {
          prMatches.push({
            apiType: 'graphql',
            cacheKey: gqlCacheKey,
            data: gqlResp,
            entry: node,
            index: i,
            parent: nodes,
            props: node
          })
        }
      }
    }
  } catch {}

  // Fallback to REST if GraphQL found no matching PRs.
  let allOpenPrs: Pr[] | undefined
  if (!prMatches.length) {
    const cacheKey = `${repo}-open-prs`
    try {
      allOpenPrs = await cacheFetch(
        cacheKey,
        async () =>
          (await octokit.paginate(octokit.pulls.list, {
            owner,
            repo,
            state: 'open',
            per_page: 100
          })) as Pr[]
      )
    } catch {}
    if (allOpenPrs) {
      for (let i = 0, { length } = allOpenPrs; i < length; i += 1) {
        const pr = allOpenPrs[i]!
        if (titlePattern.test(pr.title)) {
          prMatches.push({
            apiType: 'rest',
            cacheKey,
            data: allOpenPrs,
            entry: pr,
            index: i,
            parent: allOpenPrs,
            props: {
              baseRefName: pr.base.ref,
              headRefName: pr.head.ref,
              // Upper cased mergeable_state is equivalent to mergeStateStatus.
              // https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
              mergeStateStatus:
                pr.mergeable_state?.toUpperCase?.() ?? 'UNKNOWN',
              number: pr.number,
              title: pr.title
            }
          })
        }
      }
    }
  }

  if (!prMatches.length) {
    return
  }

  const cachesToSave = new Map<string, JsonContent>()

  await Promise.allSettled(
    prMatches.map(async match => {
      const { props } = match
      const versionText = /(?<= to )\S+/.exec(props.title)?.[0]
      const { number: prNumber } = props
      const prVersion = semver.coerce(versionText)
      // Close older PRs.
      if (prVersion && semver.lt(prVersion, newVersion)) {
        try {
          await octokit.pulls.update({
            owner,
            repo,
            pull_number: prNumber,
            state: 'closed'
          })
          logger.info(`Closed PR #${prNumber} for older version ${prVersion}`)
          // Remove entry from parent object.
          match.parent.splice(match.index, 1)
          // Mark cache to be saved.
          cachesToSave.set(match.cacheKey, match.data)
        } catch (e) {
          logger.warn(
            `Failed to close PR #${prNumber}: ${(e as Error).message}`
          )
          return
        }
      }
      // Update stale PRs.
      // https://docs.github.com/en/graphql/reference/enums#mergestatestatus
      if (props.mergeStateStatus === 'BEHIND') {
        try {
          await octokit.repos.merge({
            owner,
            repo,
            base: props.headRefName,
            head: props.baseRefName
          })
          logger.info(`Updated stale PR #${prNumber}`)
          // Update entry entry.
          if (match.apiType === 'graphql') {
            match.entry.mergeStateStatus = 'CLEAN'
          } else if (match.apiType === 'rest') {
            match.entry.mergeable_state = 'clean'
          }
          // Mark cache to be saved.
          cachesToSave.set(match.cacheKey, match.data)
        } catch (e) {
          const message = (e as Error)?.message ?? 'Unknown error'
          logger.warn(`Failed to update PR #${prNumber}: ${message}`)
        }
      }
    })
  )

  if (cachesToSave.size) {
    await Promise.allSettled(
      [...cachesToSave].map(({ 0: key, 1: data }) => writeCache(key, data))
    )
  }
}

export async function enablePrAutoMerge({
  node_id: prId,
  number: prNumber
}: Pr): Promise<boolean> {
  const octokitGraphql = getOctokitGraphql()
  let error: unknown
  try {
    const response = await octokitGraphql(
      `
      mutation EnableAutoMerge($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {
          pullRequestId: $pullRequestId,
          mergeMethod: SQUASH
        }) {
          pullRequest {
            number
          }
        }
      }`,
      { pullRequestId: prId }
    )
    const respPrNumber = (response as any)?.enablePullRequestAutoMerge
      ?.pullRequest?.number
    if (respPrNumber) {
      logger.info(`Auto-merge enabled for PR #${respPrNumber}`)
      return true
    }
  } catch (e) {
    error = e
  }
  let message = `Failed to enable auto-merge for PR #${prNumber}`
  if (error instanceof GraphqlResponseError && error.errors) {
    const details = error.errors
      .map(({ message }) => ` - ${message.trim()}`)
      .join('\n')
    message += `:\n${details}`
  }
  logger.error(message)
  return false
}

export type GitHubRepoInfo = {
  owner: string
  repo: string
}

export function getGitHubEnvRepoInfo(): GitHubRepoInfo {
  // Lazily access constants.ENV.GITHUB_REPOSITORY.
  const ownerSlashRepo = constants.ENV.GITHUB_REPOSITORY
  const slashIndex = ownerSlashRepo.indexOf('/')
  if (slashIndex === -1) {
    throw new Error('Missing GITHUB_REPOSITORY environment variable')
  }
  return {
    owner: ownerSlashRepo.slice(0, slashIndex),
    repo: ownerSlashRepo.slice(slashIndex + 1)
  }
}

export type OpenPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
  workspaceName?: string | undefined
}

export async function openPr(
  owner: string,
  repo: string,
  branch: string,
  purl: string,
  newVersion: string,
  options?: OpenPrOptions | undefined
): Promise<OctokitResponse<Pr> | null> {
  const {
    baseBranch = 'main',
    cwd = process.cwd(),
    workspaceName
  } = {
    __proto__: null,
    ...options
  } as OpenPrOptions
  // Lazily access constants.ENV.GITHUB_ACTIONS.
  if (constants.ENV.GITHUB_ACTIONS) {
    // Lazily access constants.ENV properties.
    const token =
      constants.ENV.SOCKET_SECURITY_GITHUB_PAT || constants.ENV.GITHUB_TOKEN
    const url = `https://x-access-token:${token}@github.com/${owner}/${repo}`
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

export async function prExistForBranch(
  owner: string,
  repo: string,
  branch: string
): Promise<boolean> {
  const octokit = getOctokit()
  try {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: 'open',
      per_page: 1
    })
    return prs.length > 0
  } catch {}
  return false
}
