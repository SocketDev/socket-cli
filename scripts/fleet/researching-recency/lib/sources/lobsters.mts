/**
 * @file Lobsters source adapter. Lobsters has no search API, but exposes
 *   per-tag JSON feeds (`lobste.rs/t/<tag>.json`) of recent stories. The adapter
 *   maps the search query to candidate tags, pulls each feed, and keeps stories
 *   inside the look-back window. Keyless — always available, best-effort (an
 *   unknown tag just yields nothing).
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'
import { errorMessage } from '@socketsecurity/lib-stable/errors'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

// A Lobsters story as returned by the `/t/<tag>.json` feed. Subset of fields.
export interface LobstersStory {
  short_id?: string | undefined
  title?: string | undefined
  url?: string | undefined
  score?: number | undefined
  comment_count?: number | undefined
  created_at?: string | undefined
  submitter_user?: string | undefined
  comments_url?: string | undefined
  description_plain?: string | undefined
  tags?: string[] | undefined
}

// Lobsters tags that map cleanly from a programming query. The query is matched
// against this set so a "rust async" search hits the `rust` feed. Lowercased,
// punctuation-stripped query tokens are intersected with these.
const KNOWN_TAGS: readonly string[] = [
  'ai',
  'c',
  'compilers',
  'cpp',
  'databases',
  'devops',
  'distributed',
  'go',
  'java',
  'javascript',
  'compsci',
  'networking',
  'nodejs',
  'performance',
  'programming',
  'python',
  'rust',
  'security',
  'testing',
  'web',
]

// Pick the Lobsters tag feeds to pull for a query: any known tag whose name
// appears as a query token, falling back to the broad `programming` feed.
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

export function feedUrl(tag: string): string {
  return `https://lobste.rs/t/${encodeURIComponent(tag)}.json`
}

export function toSourceItem(story: LobstersStory): SourceItem {
  const shortId = story.short_id ?? ''
  const title = story.title ?? ''
  return {
    itemId: shortId,
    source: 'lobsters',
    title,
    body: story.description_plain ?? '',
    // Prefer the linked article; fall back to the Lobsters discussion.
    url: story.url || story.comments_url || '',
    author: story.submitter_user || undefined,
    container: 'Lobsters',
    publishedAt: story.created_at || undefined,
    engagement: {
      score: story.score ?? 0,
      comments: story.comment_count ?? 0,
    },
    snippet: title,
    metadata: { tags: story.tags ?? [], commentsUrl: story.comments_url },
  }
}

function withinWindow(story: LobstersStory, context: FetchContext): boolean {
  if (!story.created_at) {
    return true
  }
  const published = Date.parse(story.created_at)
  if (Number.isNaN(published)) {
    return true
  }
  return context.now - published <= context.days * 86_400_000
}

export const lobstersAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    try {
      const tags = tagsForQuery(searchQuery)
      const collected: SourceItem[] = []
      const seen = new Set<string>()
      for (let i = 0, { length } = tags; i < length; i += 1) {
        const stories = await httpJson<LobstersStory[]>(feedUrl(tags[i]!), {
          timeout: 30_000,
        })
        const list = Array.isArray(stories) ? stories : []
        for (let j = 0, { length: storyCount } = list; j < storyCount; j += 1) {
          const story = list[j]!
          const id = story.short_id ?? ''
          if (!seen.has(id) && withinWindow(story, context)) {
            seen.add(id)
            collected.push(toSourceItem(story))
          }
        }
      }
      return {
        source: 'lobsters',
        status: 'ok',
        items: collected.slice(0, context.perStream),
      }
    } catch (error) {
      return {
        source: 'lobsters',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => true,
  source: 'lobsters',
}
