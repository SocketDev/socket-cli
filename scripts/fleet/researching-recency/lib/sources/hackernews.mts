/**
 * @file Hacker News source adapter, ported from the upstream last30days
 *   `hackernews.py`. Queries the keyless Algolia HN API
 *   (`hn.algolia.com/api/v1/search`) for stories in the look-back window, maps
 *   each hit to a SourceItem with points + comment engagement, and links the HN
 *   discussion. No credentials — always available.
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { errorMessage } from '@socketsecurity/lib-stable/errors'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

const ALGOLIA_SEARCH_URL = 'https://hn.algolia.com/api/v1/search'

// The Algolia hit fields we read. Algolia returns more; this is the subset the
// adapter maps. All optional — a hit may omit any of them.
export interface AlgoliaHit {
  objectID?: string | undefined
  title?: string | undefined
  url?: string | undefined
  author?: string | undefined
  points?: number | undefined
  num_comments?: number | undefined
  created_at_i?: number | undefined
}

interface AlgoliaResponse {
  hits?: AlgoliaHit[] | undefined
}

function isAlgoliaResponse(value: unknown): value is AlgoliaResponse {
  return typeof value === 'object' && value !== null
}

export function toSourceItem(hit: AlgoliaHit): SourceItem {
  const objectId = hit.objectID ?? ''
  const points = hit.points ?? 0
  const numComments = hit.num_comments ?? 0
  const hnUrl = `https://news.ycombinator.com/item?id=${objectId}`
  const publishedAt =
    typeof hit.created_at_i === 'number'
      ? new Date(hit.created_at_i * 1000).toISOString()
      : undefined
  const title = hit.title ?? ''
  return {
    itemId: objectId,
    source: 'hackernews',
    title,
    body: '',
    // Prefer the linked article; fall back to the HN discussion.
    url: hit.url || hnUrl,
    author: hit.author || undefined,
    container: 'Hacker News',
    publishedAt,
    engagement: { points, comments: numComments },
    snippet: title,
    metadata: { hnUrl },
  }
}

// Build the Algolia query: stories only, inside the window, with a small points
// floor that drops the long tail of zero-engagement submissions.
export function buildSearchUrl(
  searchQuery: string,
  context: FetchContext,
): string {
  const fromTs = Math.floor((context.now - context.days * 86_400_000) / 1000)
  const params = new URLSearchParams({
    query: searchQuery,
    tags: 'story',
    numericFilters: `created_at_i>${fromTs},points>2`,
    hitsPerPage: String(context.perStream),
  })
  return `${ALGOLIA_SEARCH_URL}?${params.toString()}`
}

export const hackernewsAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    try {
      const response = await httpJson<unknown>(
        buildSearchUrl(searchQuery, context),
        { timeout: 30_000 },
      )
      const hits = isAlgoliaResponse(response) ? (response.hits ?? []) : []
      return {
        source: 'hackernews',
        status: 'ok',
        items: hits.map(toSourceItem),
      }
    } catch (error) {
      return {
        source: 'hackernews',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => true,
  source: 'hackernews',
}
