/**
 * @file GitHub source adapter, ported from the upstream last30days `github.py`
 *   (trimmed to issue/PR search). Queries the GitHub search API for issues and
 *   PRs mentioning the topic in the window, mapping each to a SourceItem with
 *   comment + reaction engagement. Auth is best-effort: `GITHUB_TOKEN` if set,
 *   else `gh auth token`; unauthenticated requests still work at a lower rate
 *   limit. Always "available" — it degrades to unauthenticated rather than
 *   skipping.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

// A GitHub search/issues item. Subset of the fields the adapter maps.
export interface GithubIssue {
  number?: number | undefined
  title?: string | undefined
  html_url?: string | undefined
  body?: string | undefined
  state?: string | undefined
  comments?: number | undefined
  created_at?: string | undefined
  user?: { login?: string | undefined } | undefined
  reactions?: { total_count?: number | undefined } | undefined
  pull_request?: unknown | undefined
}

interface GithubSearchResponse {
  items?: GithubIssue[] | undefined
}

function isSearchResponse(value: unknown): value is GithubSearchResponse {
  return typeof value === 'object' && value !== null
}

// Resolve a GitHub token: the env var wins; otherwise try `gh auth token`.
// Returns undefined when neither is available (the request goes unauthenticated).
export async function resolveToken(): Promise<string | undefined> {
  const fromEnv = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN']
  if (fromEnv) {
    return fromEnv
  }
  try {
    const result = await spawn('gh', ['auth', 'token'])
    const token = String(result.stdout).trim()
    return token || undefined
  } catch {
    return undefined
  }
}

// Build the search query string: the topic, restricted to issues/PRs created in
// the window, sorted by reactions.
export function buildSearchUrl(
  searchQuery: string,
  context: FetchContext,
): string {
  const since = new Date(context.now - context.days * 86_400_000)
    .toISOString()
    .slice(0, 10)
  const qualifier = `${searchQuery} created:>=${since}`
  const params = new URLSearchParams({
    q: qualifier,
    sort: 'reactions',
    order: 'desc',
    per_page: String(context.perStream),
  })
  return `https://api.github.com/search/issues?${params.toString()}`
}

export function toSourceItem(issue: GithubIssue): SourceItem {
  const title = issue.title ?? ''
  const isPr = issue.pull_request !== undefined
  return {
    itemId: String(issue.number ?? ''),
    source: 'github',
    title,
    body: issue.body ?? '',
    url: issue.html_url ?? '',
    author: issue.user?.login || undefined,
    container: isPr ? 'GitHub PR' : 'GitHub issue',
    publishedAt: issue.created_at || undefined,
    engagement: {
      comments: issue.comments ?? 0,
      reactions: issue.reactions?.total_count ?? 0,
    },
    snippet: title,
    metadata: { state: issue.state ?? 'open', isPullRequest: isPr },
  }
}

export const githubAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    try {
      const token = await resolveToken()
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const response = await httpJson<unknown>(
        buildSearchUrl(searchQuery, context),
        { headers, timeout: 30_000 },
      )
      const items = isSearchResponse(response) ? (response.items ?? []) : []
      return {
        source: 'github',
        status: 'ok',
        items: items.map(toSourceItem),
        note: token ? undefined : 'unauthenticated (lower rate limit)',
      }
    } catch (error) {
      return {
        source: 'github',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => true,
  source: 'github',
}
