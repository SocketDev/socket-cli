/**
 * @file Cross-repo/issue discovery — the core new capability over the old
 *   single-repo `gh pr list`. Finds open PRs AND issues the team owns, across
 *   every configured repo (or the whole org), with NO date floor, via the
 *   GitHub `search/issues` API. Repeated `author:`/`label:` qualifiers AND in
 *   the search grammar, so the roster and label sets are fanned out into one
 *   query each (union by URL), keeping every query well under the 1000-result
 *   search cap. Bot authors are dropped here so Dependabot never surfaces.
 */

import { isBotLogin } from '../../lib/github-bots.mts'

import type { GhRunner, ItemKind, TeamActivityConfig } from './types.mts'

// A raw candidate straight from search, before the review-state fetch.
export interface RawCandidate {
  readonly author: string
  readonly createdAt: string
  readonly draft: boolean
  readonly kind: ItemKind
  readonly labels: readonly string[]
  readonly number: number
  readonly repo: string
  readonly title: string
  readonly updatedAt: string
  readonly url: string
}

export interface DiscoverResult {
  readonly candidates: RawCandidate[]
  readonly errors: string[]
}

// Build one `search/issues` query. Scope is the explicit repo set (`repo:` OR's
// them) or the whole org. `author`/`label`, when present, add a single AND'd
// qualifier — the caller fans out to union multiple.
export function buildSearchQuery(options: {
  author?: string | undefined
  kind: ItemKind
  label?: string | undefined
  org: string
  repos: readonly string[]
}): string {
  const opts = { __proto__: null, ...options } as typeof options
  const parts: string[] = []
  if (opts.repos.length) {
    for (const repo of opts.repos) {
      parts.push(`repo:${repo}`)
    }
  } else {
    parts.push(`org:${opts.org}`)
  }
  parts.push(`type:${opts.kind}`, 'state:open')
  if (opts.author) {
    parts.push(`author:${opts.author}`)
  }
  if (opts.label) {
    parts.push(`label:"${opts.label}"`)
  }
  return parts.join(' ')
}

// The `--jq` projection turning a search item into one flat JSON line. `repo` is
// derived from `repository_url`; `isPr` from the `pull_request` presence.
const SEARCH_JQ =
  '.items[] | {number, title, login: .user.login, ' +
  'labels: [.labels[].name], createdAt: .created_at, updatedAt: .updated_at, ' +
  'url: .html_url, isPr: (has("pull_request")), draft: (.draft // false), ' +
  'repo: (.repository_url | sub("https://api.github.com/repos/"; ""))}'

interface SearchLine {
  createdAt?: string | undefined
  draft?: boolean | undefined
  isPr?: boolean | undefined
  labels?: string[] | undefined
  login?: string | undefined
  number?: number | undefined
  repo?: string | undefined
  title?: string | undefined
  updatedAt?: string | undefined
  url?: string | undefined
}

// Run one paginated search query. `gh` returns 100/page; walk until drained.
// A page-11 hit means the 1000-result cap truncated the result — report it
// LOUD as a note rather than pretending the query was complete.
export function runSearch(
  gh: GhRunner,
  query: string,
): { candidates: RawCandidate[]; error: string | undefined } {
  const candidates: RawCandidate[] = []
  let page = 1
  for (;;) {
    const out = gh([
      'api',
      '-X',
      'GET',
      'search/issues',
      '-f',
      `q=${query}`,
      '-f',
      'per_page=100',
      '-f',
      `page=${page}`,
      '--jq',
      SEARCH_JQ,
    ])
    if (out === undefined) {
      return {
        candidates,
        error: `search failed for query \`${query}\` on page ${page}`,
      }
    }
    const lines = out.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      let parsed: SearchLine
      try {
        parsed = JSON.parse(line) as SearchLine
      } catch {
        continue
      }
      candidates.push({
        author: String(parsed.login ?? ''),
        createdAt: String(parsed.createdAt ?? ''),
        draft: Boolean(parsed.draft),
        kind: parsed.isPr ? 'pr' : 'issue',
        labels: parsed.labels ?? [],
        number: Number(parsed.number ?? 0),
        repo: String(parsed.repo ?? ''),
        title: String(parsed.title ?? ''),
        updatedAt: String(parsed.updatedAt ?? ''),
        url: String(parsed.url ?? ''),
      })
    }
    if (lines.length < 100) {
      return { candidates, error: undefined }
    }
    if (page >= 10) {
      return {
        candidates,
        error: `query \`${query}\` hit the 1000-result search cap — results TRUNCATED; narrow the roster/labels`,
      }
    }
    page += 1
  }
}

// The query fan-out for a config: each author × kind, each label × kind, unioned.
// With neither authors nor labels, one scope-only query per kind (relies on the
// repo/org scope to bound it).
export function planQueries(config: TeamActivityConfig): string[] {
  const kinds: ItemKind[] = config.includeIssues ? ['issue', 'pr'] : ['pr']
  const queries = new Set<string>()
  const authors = config.authors.length
    ? config.authors
    : [undefined as string | undefined]
  const labels = config.labels.length
    ? config.labels
    : [undefined as string | undefined]
  for (const kind of kinds) {
    for (const author of authors) {
      queries.add(
        buildSearchQuery({
          author,
          kind,
          org: config.org,
          repos: config.repos,
        }),
      )
    }
    for (const label of labels) {
      if (label === undefined) {
        continue
      }
      queries.add(
        buildSearchQuery({ kind, label, org: config.org, repos: config.repos }),
      )
    }
  }
  return [...queries].toSorted()
}

// Discover raw open candidates across the roster/labels, deduped by URL and
// with bot authors dropped (when `skipBots`). Errors are collected, never
// thrown — a partial result plus a loud error beats a silent miss.
export function discoverCandidates(
  config: TeamActivityConfig,
  gh: GhRunner,
): DiscoverResult {
  const byUrl = new Map<string, RawCandidate>()
  const errors: string[] = []
  for (const query of planQueries(config)) {
    const result = runSearch(gh, query)
    if (result.error) {
      errors.push(result.error)
    }
    for (const candidate of result.candidates) {
      if (!candidate.url || byUrl.has(candidate.url)) {
        continue
      }
      if (config.skipBots && isBotLogin(candidate.author)) {
        continue
      }
      // Never surface a draft PR for review — a draft is explicit WIP. The
      // review-state assessment also drops drafts; dropping them here keeps
      // them out of the candidate set entirely.
      if (candidate.kind === 'pr' && candidate.draft) {
        continue
      }
      byUrl.set(candidate.url, candidate)
    }
  }
  return { candidates: [...byUrl.values()], errors }
}
