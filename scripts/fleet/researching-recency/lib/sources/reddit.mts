/**
 * @file Reddit source adapter. Reddit's public `.json` endpoints now 403 from
 *   most non-residential IPs, so this adapter uses the keyless Atom RSS search
 *   feed (`reddit.com/r/<sub>/search.rss`) — the load-bearing free path in the
 *   upstream last30days `reddit_keyless.py`. It parses the Atom entries (no XML
 *   dep — the feed shape is fixed) into SourceItems. Best-effort: a 403 or
 *   empty feed yields `[]`, never throws past the adapter boundary.
 */

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { httpText } from '@socketsecurity/lib-stable/http-request'

import type {
  FetchContext,
  SourceAdapter,
  SourceItem,
  SourceResult,
} from '../types.mts'

// Default programming subreddits searched when the plan names none.
export const DEFAULT_SUBREDDITS: readonly string[] = [
  'programming',
  'ExperiencedDevs',
  'webdev',
]

// Reddit asks RSS clients to send a descriptive UA; a generic one gets 429/403.
const USER_AGENT = 'researching-recency/1.0 (fleet research skill)'

export function searchFeedUrl(
  subreddit: string,
  searchQuery: string,
  context: FetchContext,
): string {
  const window =
    context.days <= 7 ? 'week' : context.days <= 31 ? 'month' : 'year'
  const params = new URLSearchParams({
    q: searchQuery,
    restrict_sr: '1',
    sort: 'top',
    t: window,
    limit: String(context.perStream),
  })
  return `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.rss?${params.toString()}`
}

// Decode the handful of XML entities Reddit's Atom feed emits.
function decodeXmlEntities(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
}

function tagText(entry: string, tag: string): string {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  return match ? decodeXmlEntities(match[1]!.trim()) : ''
}

// Parse the Atom feed XML into SourceItems for one subreddit. Exported so the
// parser is unit-testable against a fixture feed without a network round-trip.
export function parseFeed(xml: string, subreddit: string): SourceItem[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? []
  return entries.map(entry => {
    const id = tagText(entry, 'id')
    const title = tagText(entry, 'title')
    const author = tagText(entry, 'name')
    const published = tagText(entry, 'published') || tagText(entry, 'updated')
    const linkMatch = entry.match(/<link[^>]*href="([^"]*)"/)
    const url = linkMatch ? decodeXmlEntities(linkMatch[1]!) : ''
    // The Atom <content> is escaped HTML; strip tags for a plain snippet.
    const contentHtml = tagText(entry, 'content')
    const body = contentHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return {
      itemId: id,
      source: 'reddit',
      title,
      body,
      url,
      // Atom author name arrives as `/u/<handle>`; keep the bare handle.
      author: author.replace(/^\/u\//, '') || undefined,
      container: `r/${subreddit}`,
      publishedAt: published || undefined,
      // The RSS feed carries no score/comment counts; engagement is enriched
      // elsewhere or left empty (the item still ranks on relevance + freshness).
      engagement: {},
      snippet: body.slice(0, 280),
      metadata: { subreddit },
    }
  })
}

export const redditAdapter: SourceAdapter = {
  async fetch(
    searchQuery: string,
    context: FetchContext,
  ): Promise<SourceResult> {
    try {
      const collected: SourceItem[] = []
      const seen = new Set<string>()
      for (let i = 0, { length } = DEFAULT_SUBREDDITS; i < length; i += 1) {
        const subreddit = DEFAULT_SUBREDDITS[i]!
        const xml = await httpText(
          searchFeedUrl(subreddit, searchQuery, context),
          { headers: { 'User-Agent': USER_AGENT }, timeout: 30_000 },
        )
        const items = parseFeed(xml, subreddit)
        for (let j = 0, { length: count } = items; j < count; j += 1) {
          const item = items[j]!
          if (!seen.has(item.itemId)) {
            seen.add(item.itemId)
            collected.push(item)
          }
        }
      }
      return {
        source: 'reddit',
        status: 'ok',
        items: collected.slice(0, context.perStream),
      }
    } catch (error) {
      return {
        source: 'reddit',
        status: 'error',
        items: [],
        note: errorMessage(error),
      }
    }
  },
  isAvailable: () => true,
  source: 'reddit',
}
