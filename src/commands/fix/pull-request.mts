import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  GraphqlResponseError,
  graphql as OctokitGraphql,
} from '@octokit/graphql'
import { RequestError } from '@octokit/request-error'
import { Octokit } from '@octokit/rest'
import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import {
  readJson,
  safeStatsSync,
  writeJson,
} from '@socketsecurity/registry/lib/fs'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import {
  createSocketBranchParser,
  getSocketBranchPattern,
  getSocketPullRequestBody,
  getSocketPullRequestTitle,
} from './socket-git.mts'
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
      debugFn('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    const octokitOptions = {
      auth: SOCKET_CLI_GITHUB_TOKEN,
      // Lazily access constants.ENV.GITHUB_API_URL.
      baseUrl: constants.ENV.GITHUB_API_URL,
    }
    debugDir('inspect', { octokitOptions })
    _octokit = new Octokit(octokitOptions)
  }
  return _octokit
}

let _octokitGraphql: typeof OctokitGraphql | undefined
export function getOctokitGraphql(): typeof OctokitGraphql {
  if (!_octokitGraphql) {
    // Lazily access constants.ENV.SOCKET_CLI_GITHUB_TOKEN.
    const { SOCKET_CLI_GITHUB_TOKEN } = constants.ENV
    if (!SOCKET_CLI_GITHUB_TOKEN) {
      debugFn('notice', 'miss: SOCKET_CLI_GITHUB_TOKEN env var')
    }
    _octokitGraphql = OctokitGraphql.defaults({
      headers: {
        authorization: `token ${SOCKET_CLI_GITHUB_TOKEN}`,
      },
    })
  }
  return _octokitGraphql
}

async function readCache(
  key: string,
  // 5 minute in milliseconds time to live (TTL).
  ttlMs = 5 * 60 * 1000,
): Promise<JsonContent | null> {
  // Lazily access constants.githubCachePath.
  const cacheJsonPath = path.join(constants.githubCachePath, `${key}.json`)
  const stat = safeStatsSync(cacheJsonPath)
  if (stat) {
    const isExpired = Date.now() - stat.mtimeMs > ttlMs
    if (!isExpired) {
      return await readJson(cacheJsonPath)
    }
  }
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

export type GQL_MERGE_STATE_STATUS =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE'

export type GQL_PR_STATE = 'OPEN' | 'CLOSED' | 'MERGED'

export type PrMatch = {
  author: string
  baseRefName: string
  headRefName: string
  mergeStateStatus: GQL_MERGE_STATE_STATUS
  number: number
  state: GQL_PR_STATE
  title: string
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

export type CleanupPrsOptions = {
  newVersion?: string | undefined
  purl?: string | undefined
  workspace?: string | undefined
}

export async function cleanupPrs(
  owner: string,
  repo: string,
  options?: CleanupPrsOptions | undefined,
): Promise<PrMatch[]> {
  const contextualMatches = await getSocketPrsWithContext(owner, repo, options)

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
          debugFn('notice', `pr: closing ${prRef} for ${prToVersion}`)
          // Remove entry from parent object.
          context.parent.splice(context.index, 1)
          // Mark cache to be saved.
          cachesToSave.set(context.cacheKey, context.data)
          return null
        } catch (e) {
          debugFn(
            'error',
            `pr: failed to close ${prRef} for ${prToVersion}\n`,
            (e as Error)?.message || 'Unknown error',
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
          debugFn('notice', `pr: updating stale ${prRef}`)
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
          debugFn('error', `pr: failed to update ${prRef} - ${message}`)
        }
      }
      return match
    }),
  )

  if (cachesToSave.size) {
    await Promise.allSettled(
      Array.from(cachesToSave).map(({ 0: key, 1: data }) =>
        writeCache(key, data),
      ),
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
    const details = error.errors.map(({ message: m }) => m.trim())
    return { enabled: false, details }
  }
  return { enabled: false }
}

export type SocketPrsOptions = {
  author?: string | undefined
  newVersion?: string | undefined
  purl?: string | undefined
  states?: string[] | string | undefined
  workspace?: string | undefined
}

export async function getSocketPrs(
  owner: string,
  repo: string,
  options?: SocketPrsOptions | undefined,
): Promise<PrMatch[]> {
  return (await getSocketPrsWithContext(owner, repo, options)).map(d => d.match)
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

async function getSocketPrsWithContext(
  owner: string,
  repo: string,
  options?: SocketPrsOptions | undefined,
): Promise<ContextualPrMatch[]> {
  const { author, states: statesValue = 'all' } = {
    __proto__: null,
    ...options,
  } as SocketPrsOptions
  const branchPattern = getSocketBranchPattern(options)
  const checkAuthor = isNonEmptyString(author)
  const octokit = getOctokit()
  const octokitGraphql = getOctokitGraphql()
  const contextualMatches: ContextualPrMatch[] = []
  const states = (
    typeof statesValue === 'string'
      ? statesValue.toLowerCase() === 'all'
        ? ['OPEN', 'CLOSED', 'MERGED']
        : [statesValue]
      : statesValue
  ).map(s => s.toUpperCase())
  try {
    // Optimistically fetch only the first 50 open PRs using GraphQL to minimize
    // API quota usage. Fallback to REST if no matching PRs are found.
    const gqlCacheKey = `${repo}-pr-graphql-snapshot`
    const gqlResp = await cacheFetch(gqlCacheKey, () =>
      octokitGraphql(
        `
          query($owner: String!, $repo: String!, $states: [PullRequestState!]) {
            repository(owner: $owner, name: $repo) {
              pullRequests(first: 50, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) {
                nodes {
                  author {
                    login
                  }
                  baseRefName
                  headRefName
                  mergeStateStatus
                  number
                  state
                  title
                }
              }
            }
          }
          `,
        {
          owner,
          repo,
          states,
        },
      ),
    )

    type GqlPrNode = {
      author?: {
        login: string
      }
      baseRefName: string
      headRefName: string
      mergeStateStatus: GQL_MERGE_STATE_STATUS
      number: number
      state: GQL_PR_STATE
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
  let allPrs: Pr[] | undefined
  const cacheKey = `${repo}-pull-requests`
  try {
    allPrs = await cacheFetch(
      cacheKey,
      async () =>
        (await octokit.paginate(octokit.pulls.list, {
          owner,
          repo,
          state: 'all',
          per_page: 100,
        })) as Pr[],
    )
  } catch {}

  if (!allPrs) {
    return contextualMatches
  }

  for (let i = 0, { length } = allPrs; i < length; i += 1) {
    const pr = allPrs[i]!
    const login = pr.user?.login
    const headRefName = pr.head.ref
    const matchesAuthor = checkAuthor ? login === author : true
    const matchesBranch = branchPattern.test(headRefName)
    if (matchesAuthor && matchesBranch) {
      // Upper cased mergeable_state is equivalent to mergeStateStatus.
      // https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
      const mergeStateStatus = (pr.mergeable_state?.toUpperCase?.() ??
        'UNKNOWN') as GQL_MERGE_STATE_STATUS
      // The REST API does not have a distinct merged state for pull requests.
      // Instead, a merged pull request is represented as a closed pull request
      // with a non-null merged_at timestamp.
      const state = (
        pr.merged_at ? 'MERGED' : pr.state.toUpperCase()
      ) as GQL_PR_STATE
      contextualMatches.push({
        context: {
          apiType: 'rest',
          cacheKey,
          data: allPrs,
          entry: pr,
          index: i,
          parent: allPrs,
        },
        match: {
          author: login ?? '<unknown>',
          baseRefName: pr.base.ref,
          headRefName,
          mergeStateStatus,
          number: pr.number,
          state,
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
    const octokitPullsCreateParams = {
      owner,
      repo,
      title: getSocketPullRequestTitle(purlObj, newVersion, workspace),
      head: branch,
      base: baseBranch,
      body: getSocketPullRequestBody(purlObj, newVersion, workspace),
    }
    debugDir('inspect', { octokitPullsCreateParams })
    return await octokit.pulls.create(octokitPullsCreateParams)
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
    debugFn('error', message)
  }
  return null
}

export type OpenCoanaPrOptions = {
  baseBranch?: string | undefined
  cwd?: string | undefined
}

export async function openCoanaPr(
  owner: string,
  repo: string,
  branch: string,
  ghsaIds: string[],
  options?: OpenCoanaPrOptions | undefined,
): Promise<OctokitResponse<Pr> | null> {
  const { baseBranch = 'main' } = {
    __proto__: null,
    ...options,
  } as OpenCoanaPrOptions

  const octokit = getOctokit()
  const vulnCount = ghsaIds.length

  const prTitle =
    vulnCount === 1 ? `Fix for ${ghsaIds[0]}` : `Fixes for ${vulnCount} GHSAs`

  let prBody = ''
  if (vulnCount === 1) {
    prBody = `[Socket](https://socket.dev/) fix for [${ghsaIds[0]}](https://github.com/advisories/${ghsaIds[0]}).`
  } else {
    prBody = `[Socket](https://socket.dev/) fixes for ${vulnCount} GHSAs.\n\n**Fixed GHSAs:**\n${ghsaIds.map(id => `- [${id}](https://github.com/advisories/${id})`).join('\n')}`
  }

  try {
    const octokitPullsCreateParams = {
      owner,
      repo,
      title: prTitle,
      head: branch,
      base: baseBranch,
      body: prBody,
    }
    debugDir('inspect', { octokitPullsCreateParams })
    return await octokit.pulls.create(octokitPullsCreateParams)
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
    debugFn('error', message)
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
      state: 'all',
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
): Promise<boolean> {
  const { host } = new URL(constants.ENV.GITHUB_SERVER_URL)
  const url = `https://x-access-token:${token}@${host}/${owner}/${repo}`
  const stdioIgnoreOptions: SpawnOptions = {
    cwd,
    stdio: isDebug('stdio') ? 'inherit' : 'ignore',
  }
  const quotedCmd = `\`git remote set-url origin ${url}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    await spawn('git', ['remote', 'set-url', 'origin', url], stdioIgnoreOptions)
    return true
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return false
}
