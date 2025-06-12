import { existsSync, promises as fs, statSync } from 'node:fs'
import path from 'node:path'

import {
  GraphqlResponseError,
  graphql as OctokitGraphql,
} from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { Octokit } from '@octokit/rest'
import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { debugFn } from '@socketsecurity/registry/lib/debug'
import { readJson, writeJson } from '@socketsecurity/registry/lib/fs'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import {
  createSocketBranchParser,
  getSocketBranchPattern,
  getSocketPullRequestBody,
  getSocketPullRequestTitle,
} from './git.mts'
import constants from '../../constants.mts'
import { getPurlObject } from '../../utils/purl.mts'

import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { components } from '@octokit/openapi-types'
import type { OctokitResponse } from '@octokit/types'
import type { JsonContent } from '@socketsecurity/registry/lib/fs'
import type { SpawnOptions } from '@socketsecurity/registry/lib/spawn'

let _octokit: Octokit | undefined
function getOctokit() {
  if (_octokit === undefined) {
    // Lazily access constants.ENV.SOCKET_CLI_GITHUB_TOKEN.
    const { SOCKET_CLI_GITHUB_TOKEN } = constants.ENV
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugFn('miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    _octokit = new Octokit({
      auth: SOCKET_CLI_GITHUB_TOKEN,
    })
  }
  return _octokit
}

let _octokitGraphql: typeof OctokitGraphql | undefined
export function getOctokitGraphql(): typeof OctokitGraphql {
  if (!_octokitGraphql) {
    // Lazily access constants.ENV.SOCKET_CLI_GITHUB_TOKEN.
    const { SOCKET_CLI_GITHUB_TOKEN } = constants.ENV
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugFn('miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    _octokitGraphql = OctokitGraphql.defaults({
      headers: {
        authorization: `token ${SOCKET_CLI_GITHUB_TOKEN}`,
      },
    })
  }
  return _octokitGraphql
}

export async function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs?: number | undefined,
): Promise<T> {
  // Optionally disable cache.
  // Lazily access constants.ENV.DISABLE_GITHUB_CACHE.
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
  ttlMs = 5 * 60 * 1000,
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

export type MERGE_STATE_STATUS =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE'

export type PrMatch = {
  author: string
  baseRefName: string
  headRefName: string
  mergeStateStatus: MERGE_STATE_STATUS
  number: number
  title: string
}

export type CleanupPrsOptions = {
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export async function cleanupOpenPrs(
  owner: string,
  repo: string,
  options?: CleanupPrsOptions | undefined,
): Promise<PrMatch[]> {
  const contextualMatches = await getOpenSocketPrsWithContext(
    owner,
    repo,
    options,
  )

  if (!contextualMatches.length) {
    return []
  }

  const cachesToSave = new Map<string, JsonContent>()
  const { newVersion } = { __proto__: null, ...options } as CleanupPrsOptions
  const branchParser = createSocketBranchParser(options)
  const octokit = getOctokit()

  const settledMatches = await Promise.allSettled(
    contextualMatches.map(async ({ context, match }) => {
      const { number: prNum } = match
      const prRef = `PR #${prNum}`
      const parsedBranch = branchParser(match.headRefName)
      const prToVersion = parsedBranch?.newVersion

      // Close older PRs.
      if (prToVersion && newVersion && semver.lt(prToVersion, newVersion)) {
        try {
          await octokit.pulls.update({
            owner,
            repo,
            pull_number: prNum,
            state: 'closed',
          })
          debugFn(`close: ${prRef} for ${prToVersion}`)
          // Remove entry from parent object.
          context.parent.splice(context.index, 1)
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
          return null
        } catch (e) {
          debugFn(
            `fail: close ${prRef} for ${prToVersion}\n`,
            (e as Error)?.message || 'unknown error',
          )
        }
      }
      // Update stale PRs.
      // https://docs.github.com/en/graphql/reference/enums#mergestatestatus
      if (match.mergeStateStatus === 'BEHIND') {
        try {
          await octokit.repos.merge({
            owner,
            repo,
            base: match.headRefName,
            head: match.baseRefName,
          })
          debugFn('update: stale', prRef)
          // Update entry entry.
          if (context.apiType === 'graphql') {
            context.entry.mergeStateStatus = 'CLEAN'
          } else if (context.apiType === 'rest') {
            context.entry.mergeable_state = 'clean'
          }
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
        } catch (e) {
          const message = (e as Error)?.message || 'Unknown error'
          debugFn(`fail: update ${prRef} - ${message}`)
        }
      }
      return match
    }),
  )

  if (cachesToSave.size) {
    await Promise.allSettled(
      [...cachesToSave].map(({ 0: key, 1: data }) => writeCache(key, data)),
    )
  }

  const fulfilledMatches = settledMatches.filter(
    r => r.status === 'fulfilled' && r.value,
  ) as unknown as Array<PromiseFulfilledResult<ContextualPrMatch>>

  return fulfilledMatches.map(r => r.value.match)
}

export type PrAutoMergeState = {
  enabled: boolean
  details?: string[]
}

export async function enablePrAutoMerge({
  node_id: prId,
}: Pr): Promise<PrAutoMergeState> {
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
      { pullRequestId: prId },
    )
    const respPrNumber = (response as any)?.enablePullRequestAutoMerge
      ?.pullRequest?.number
    if (respPrNumber) {
      return { enabled: true }
    }
  } catch (e) {
    error = e
  }
  if (
    error instanceof GraphqlResponseError &&
    Array.isArray(error.errors) &&
    error.errors.length
  ) {
    const details = error.errors.map(({ message }) => message.trim())
    return { enabled: false, details }
  }
  return { enabled: false }
}

export type GetOpenSocketPrsOptions = {
  author?: string | undefined
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export async function getOpenSocketPrs(
  owner: string,
  repo: string,
  options?: GetOpenSocketPrsOptions | undefined,
): Promise<PrMatch[]> {
  return (await getOpenSocketPrsWithContext(owner, repo, options)).map(
    d => d.match,
  )
}

type ContextualPrMatch = {
  context: {
    apiType: 'graphql' | 'rest'
    cacheKey: string
    data: any
    entry: any
    index: number
    parent: any[]
  }
  match: PrMatch
}

async function getOpenSocketPrsWithContext(
  owner: string,
  repo: string,
  options_?: GetOpenSocketPrsOptions | undefined,
): Promise<ContextualPrMatch[]> {
  const options = { __proto__: null, ...options_ } as GetOpenSocketPrsOptions
  const { author } = options
  const checkAuthor = isNonEmptyString(author)
  const octokit = getOctokit()
  const octokitGraphql = getOctokitGraphql()
  const branchPattern = getSocketBranchPattern(options)

  const contextualMatches: ContextualPrMatch[] = []
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
                  author {
                    login
                  }
                  baseRefName
                  headRefName
                  mergeStateStatus
                  number
                  title
                }
              }
            }
          }
          `,
        { owner, repo },
      ),
    )

    type GqlPrNode = {
      author?: {
        login: string
      }
      baseRefName: string
      headRefName: string
      mergeStateStatus: MERGE_STATE_STATUS
      number: number
      title: string
    }
    const nodes: GqlPrNode[] =
      (gqlResp as any)?.repository?.pullRequests?.nodes ?? []
    for (let i = 0, { length } = nodes; i < length; i += 1) {
      const node = nodes[i]!
      const login = node.author?.login
      const matchesAuthor = checkAuthor ? login === author : true
      const matchesBranch = branchPattern.test(node.headRefName)
      if (matchesAuthor && matchesBranch) {
        contextualMatches.push({
          context: {
            apiType: 'graphql',
            cacheKey: gqlCacheKey,
            data: gqlResp,
            entry: node,
            index: i,
            parent: nodes,
          },
          match: {
            ...node,
            author: login ?? '<unknown>',
          },
        })
      }
    }
  } catch {}

  if (contextualMatches.length) {
    return contextualMatches
  }

  // Fallback to REST if GraphQL found no matching PRs.
  let allOpenPrs: Pr[] | undefined
  const cacheKey = `${repo}-open-prs`
  try {
    allOpenPrs = await cacheFetch(
      cacheKey,
      async () =>
        (await octokit.paginate(octokit.pulls.list, {
          owner,
          repo,
          state: 'open',
          per_page: 100,
        })) as Pr[],
    )
  } catch {}

  if (!allOpenPrs) {
    return contextualMatches
  }

  for (let i = 0, { length } = allOpenPrs; i < length; i += 1) {
    const pr = allOpenPrs[i]!
    const login = pr.user?.login
    const matchesAuthor = checkAuthor ? login === author : true
    const matchesBranch = branchPattern.test(pr.head.ref)
    if (matchesAuthor && matchesBranch) {
      contextualMatches.push({
        context: {
          apiType: 'rest',
          cacheKey,
          data: allOpenPrs,
          entry: pr,
          index: i,
          parent: allOpenPrs,
        },
        match: {
          author: login ?? '<unknown>',
          baseRefName: pr.base.ref,
          headRefName: pr.head.ref,
          // Upper cased mergeable_state is equivalent to mergeStateStatus.
          // https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
          mergeStateStatus: (pr.mergeable_state?.toUpperCase?.() ??
            'UNKNOWN') as MERGE_STATE_STATUS,
          number: pr.number,
          title: pr.title,
        },
      })
    }
  }
  return contextualMatches
}

export type OpenPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
  workspace?: string | undefined
}

export async function openPr(
  owner: string,
  repo: string,
  branch: string,
  purl: string | PackageURL | SocketArtifact,
  newVersion: string,
  options?: OpenPrOptions | undefined,
): Promise<OctokitResponse<Pr> | null> {
  const { baseBranch = 'main', workspace } = {
    __proto__: null,
    ...options,
  } as OpenPrOptions
  const purlObj = getPurlObject(purl)
  const octokit = getOctokit()
  try {
    return await octokit.pulls.create({
      owner,
      repo,
      title: getSocketPullRequestTitle(purlObj, newVersion, workspace),
      head: branch,
      base: baseBranch,
      body: getSocketPullRequestBody(purlObj, newVersion, workspace),
    })
  } catch (e) {
    let message = `Failed to open pull request`
    const errors =
      e instanceof RequestError
        ? (e.response?.data as any)?.['errors']
        : undefined
    if (Array.isArray(errors) && errors.length) {
      const details = errors
        .map(
          d =>
            `- ${d.message?.trim() ?? `${d.resource}.${d.field} (${d.code})`}`,
        )
        .join('\n')
      message += `:\n${details}`
    }
    debugFn(message)
  }
  return null
}

export async function prExistForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  const octokit = getOctokit()
  try {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      state: 'open',
      per_page: 1,
    })
    return prs.length > 0
  } catch {}
  return false
}

export async function setGitRemoteGithubRepoUrl(
  owner: string,
  repo: string,
  token: string,
  cwd = process.cwd(),
): Promise<void> {
  const stdioIgnoreOptions: SpawnOptions = { cwd, stdio: 'ignore' }
  const url = `https://x-access-token:${token}@github.com/${owner}/${repo}`
  try {
    await spawn('git', ['remote', 'set-url', 'origin', url], stdioIgnoreOptions)
  } catch (e) {
    debugFn('catch: unexpected\n', e)
  }
}
