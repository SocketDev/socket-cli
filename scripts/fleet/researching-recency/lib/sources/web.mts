/**
 * @file Web source adapter. The engine has no web-search API key of its own —
 *   the model runs WebSearch and writes its hits to a JSON file passed as
 *   `--web-file`. This module parses that file into SourceItems. There's no
 *   network call here (the model already did the searching), so it's a pure
 *   mapper rather than a fetching adapter.
 */

import type { SourceItem } from '../types.mts'

// One web hit as the model writes it to the --web-file JSON array. Title + url
// are required; the rest are optional context the model may include.
export interface WebHit {
  title?: string | undefined
  url?: string | undefined
  snippet?: string | undefined
  publishedAt?: string | undefined
  source?: string | undefined
}

function isWebHit(value: unknown): value is WebHit {
  return typeof value === 'object' && value !== null
}

export function toSourceItem(hit: WebHit, index: number): SourceItem {
  const title = hit.title ?? ''
  const snippet = hit.snippet ?? ''
  return {
    itemId: hit.url || `web:${index}`,
    source: 'web',
    title,
    body: snippet,
    url: hit.url ?? '',
    container: hit.source || 'Web',
    publishedAt: hit.publishedAt || undefined,
    // Web hits carry no engagement signal — they rank on relevance + freshness.
    engagement: {},
    snippet: snippet || title,
    metadata: {},
  }
}

// Parse the model-supplied web-hits file content into SourceItems. Accepts
// either a bare array or a `{ hits: [...] }` wrapper. Malformed entries are
// dropped (an entry with no url can't be cited).
export function parseWebHits(fileContent: string): SourceItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(fileContent)
  } catch {
    return []
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : isWebHit(parsed) &&
        Array.isArray((parsed as { hits?: unknown[] | undefined }).hits)
      ? (parsed as { hits: unknown[] }).hits
      : []
  const items: SourceItem[] = []
  for (let i = 0, { length } = raw; i < length; i += 1) {
    const hit = raw[i]
    if (isWebHit(hit) && hit.url) {
      items.push(toSourceItem(hit, i))
    }
  }
  return items
}
