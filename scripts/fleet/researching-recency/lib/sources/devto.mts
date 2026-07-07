/**
 * @file Dev.to source adapter. Uses the keyless Forem articles API
 *   (`dev.to/api/articles?tag=<tag>`) — there's no full-text search, so the
 *   query maps to a tag the same way Lobsters does. Maps each article to a
 *   SourceItem with reaction + comment engagement. Keyless, best-effort.
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { errorMessage } from '@socketsecurity/lib-stable/errors'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

// A dev.to article from the Forem articles API. Subset of fields.
export interface DevtoArticle {
  id?: number | undefined
  title?: string | undefined
  description?: string | undefined
  url?: string | undefined
  published_at?: string | undefined
  positive_reactions_count?: number | undefined
  public_reactions_count?: number | undefined
  comments_count?: number | undefined
  tag_list?: string[] | undefined
  user?:
    | { name?: string | undefined; username?: string | undefined }
    | undefined
}

// dev.to tag slugs (no hyphens/spaces) that map from a programming query.
const KNOWN_TAGS: readonly string[] = [
  'ai',
  'androiddev',
  'aws',
  'cpp',
  'css',
  'devops',
  'docker',
  'go',
  'java',
  'javascript',
  'kubernetes',
  'machinelearning',
  'node',
  'programming',
  'python',
  'react',
  'rust',
  'security',
  'testing',
  'typescript',
  'webdev',
]

// Pick dev.to tags for a query: known tags appearing as query tokens, else the
// broad `programming` tag.
export function tagsForQuery(searchQuery: string): string[] {
  const tokens = new Set(
    searchQuery
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 0),
  )
  const matched = KNOWN_TAGS.filter(tag => tokens.has(tag))
  return matched.length > 0 ? matched : ['programming']
}

export function articlesUrl(tag: string, perPage: number): string {
  const params = new URLSearchParams({
    tag,
    per_page: String(perPage),
    top: '30',
  })
  return `https://dev.to/api/articles?${params.toString()}`
}

export function toSourceItem(article: DevtoArticle): SourceItem {
  const title = article.title ?? ''
  const reactions =
    article.public_reactions_count ?? article.positive_reactions_count ?? 0
  return {
    itemId: String(article.id ?? ''),
    source: 'devto',
    title,
    body: article.description ?? '',
    url: article.url ?? '',
    author: article.user?.name || article.user?.username || undefined,
    container: 'dev.to',
    publishedAt: article.published_at || undefined,
    engagement: { reactions, comments: article.comments_count ?? 0 },
    snippet: article.description ?? title,
    metadata: { tags: article.tag_list ?? [] },
  }
}

export const devtoAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    try {
      const tags = tagsForQuery(searchQuery)
      const collected: SourceItem[] = []
      const seen = new Set<string>()
      for (let i = 0, { length } = tags; i < length; i += 1) {
        const articles = await httpJson<DevtoArticle[]>(
          articlesUrl(tags[i]!, context.perStream),
          { timeout: 30_000 },
        )
        const list = Array.isArray(articles) ? articles : []
        for (let j = 0, { length: count } = list; j < count; j += 1) {
          const article = list[j]!
          const id = String(article.id ?? '')
          if (!seen.has(id)) {
            seen.add(id)
            collected.push(toSourceItem(article))
          }
        }
      }
      return {
        source: 'devto',
        status: 'ok',
        items: collected.slice(0, context.perStream),
      }
    } catch (error) {
      return {
        source: 'devto',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => true,
  source: 'devto',
}
