/**
 * @file Weighted reciprocal-rank fusion, ported from the upstream last30days
 *   `fusion.py`. Merges the per-(subquery, source) ranked streams into one
 *   candidate pool: each stream contributes weight / (RRF_K + rank) to the
 *   candidate it surfaced, candidates seen in multiple streams accumulate, and
 *   the pool is capped per author and diversified across sources before
 *   truncation. URL canonicalization keys the merge so the same link from two
 *   streams fuses into one candidate. Lock-step with: last30days `fusion.py`
 *   (RRF_K, the 0.25 diversity threshold, the 3-per-author cap, and the
 *   primary-score tiebreak; keep identical for ranking parity).
 */

import type { Candidate, QueryPlan, SourceItem, SourceName } from './types.mts'

// Standard RRF smoothing constant (Cormack et al. 2009). Larger K flattens the
// rank-position advantage.
export const RRF_K = 60

// Below this local-relevance ceiling a source doesn't earn reserved diversity
// slots — it competes on merit only.
const DIVERSITY_RELEVANCE_THRESHOLD = 0.25

// No single author/handle should dominate the pool.
const MAX_ITEMS_PER_AUTHOR = 3

// Separator joining a subquery label and a source into a stream key. A subquery
// label is a slug (no spaces) and a source name is a fixed lowercase token, so a
// single space unambiguously splits the two. The format is defined here once;
// `streamKeyOf` builds it, `parseStreamKey` reads it, and fetch + tests use both
// rather than hard-coding the separator.
const STREAM_KEY_SEPARATOR = ' '

// Build the `streams` map key for a (label, source) pair.
export function streamKeyOf(label: string, source: SourceName): string {
  return `${label}${STREAM_KEY_SEPARATOR}${source}`
}

// Split a stream key back into its label and source.
export function parseStreamKey(key: string): {
  label: string
  source: string
} {
  const index = key.indexOf(STREAM_KEY_SEPARATOR)
  return {
    label: key.slice(0, index),
    source: key.slice(index + STREAM_KEY_SEPARATOR.length),
  }
}

// Canonicalize a URL for dedup: lowercase, strip www/old/m host prefixes, drop
// utm_* tracking params, trim a trailing slash. Falls back to the raw lowercased
// string when the URL doesn't parse.
export function normalizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return trimmed
  }
  let host = parsed.host
  for (const prefix of ['www.', 'old.', 'm.']) {
    if (host.startsWith(prefix)) {
      host = host.slice(prefix.length)
      break
    }
  }
  const params = new URLSearchParams()
  for (const [key, value] of parsed.searchParams) {
    if (!key.startsWith('utm_')) {
      params.append(key, value)
    }
  }
  const pathname = parsed.pathname.replace(/\/+$/, '')
  const query = params.toString()
  return `${parsed.protocol}//${host}${pathname}${query ? `?${query}` : ''}`
}

// The merge key for an item: its canonical URL, or `<source>:<itemId>` when it
// has no URL.
export function candidateKey(item: SourceItem): string {
  return item.url ? normalizeUrl(item.url) : `${item.source}:${item.itemId}`
}

// Sort key (ascending compare): higher rrfScore, then relevance, then freshness,
// then source name, then title. Returns negative when `a` should rank first.
function compareCandidates(a: Candidate, b: Candidate): number {
  return (
    b.rrfScore - a.rrfScore ||
    b.localRelevance - a.localRelevance ||
    b.freshness - a.freshness ||
    a.source.localeCompare(b.source) ||
    a.title.localeCompare(b.title)
  )
}

function primaryScore(
  localRelevance: number,
  freshness: number,
  sourceQuality: number,
): number {
  return localRelevance * 100 + freshness + sourceQuality * 10
}

function authorOf(candidate: Candidate): string | undefined {
  for (let i = 0, { length } = candidate.sourceItems; i < length; i += 1) {
    const author = candidate.sourceItems[i]!.author
    if (author) {
      return author.trim().toLowerCase()
    }
  }
  return undefined
}

// Keep at most `maxPerAuthor` candidates from any single author. Input is
// assumed already sorted by quality, so the first N per author are the best.
function applyPerAuthorCap(
  candidates: Candidate[],
  maxPerAuthor = MAX_ITEMS_PER_AUTHOR,
): Candidate[] {
  const counts = new Map<string, number>()
  const result: Candidate[] = []
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]!
    const author = authorOf(candidate)
    if (author === undefined) {
      result.push(candidate)
      continue
    }
    const count = counts.get(author) ?? 0
    if (count < maxPerAuthor) {
      result.push(candidate)
      counts.set(author, count + 1)
    }
  }
  return result
}

// Reserve up to `minPerSource` slots for each source whose best item clears the
// relevance threshold, so a strong-but-quiet source survives truncation. The
// remainder competes for the leftover slots on merit.
function diversifyPool(
  fused: Candidate[],
  poolLimit: number,
  minPerSource = 2,
): Candidate[] {
  const maxRelevance = new Map<SourceName, number>()
  for (let i = 0, { length } = fused; i < length; i += 1) {
    const candidate = fused[i]!
    const current = maxRelevance.get(candidate.source) ?? 0
    if (candidate.localRelevance > current) {
      maxRelevance.set(candidate.source, candidate.localRelevance)
    }
  }

  const reserved = new Map<SourceName, Candidate[]>()
  const remainder: Candidate[] = []
  for (let i = 0, { length } = fused; i < length; i += 1) {
    const candidate = fused[i]!
    const qualifies =
      (maxRelevance.get(candidate.source) ?? 0) >= DIVERSITY_RELEVANCE_THRESHOLD
    const bucket = reserved.get(candidate.source) ?? []
    if (qualifies && bucket.length < minPerSource) {
      bucket.push(candidate)
      reserved.set(candidate.source, bucket)
    } else {
      remainder.push(candidate)
    }
  }

  const pool: Candidate[] = []
  for (const bucket of reserved.values()) {
    pool.push(...bucket)
  }
  const seen = new Set(pool.map(candidate => candidate.candidateId))
  for (let i = 0, { length } = remainder; i < length; i += 1) {
    if (pool.length >= poolLimit) {
      break
    }
    const candidate = remainder[i]!
    if (!seen.has(candidate.candidateId)) {
      pool.push(candidate)
      seen.add(candidate.candidateId)
    }
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- `pool` is a locally-built array (declared `const pool: Candidate[] = []` and filled via .push() above), so the in-place sort can't mutate a shared receiver; .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  return pool.sort(compareCandidates).slice(0, poolLimit)
}

function makeCandidate(
  key: string,
  item: SourceItem,
  label: string,
  rank: number,
  score: number,
): Candidate {
  return {
    candidateId: key,
    itemId: item.itemId,
    source: item.source,
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    subqueryLabels: [label],
    nativeRanks: { [`${label}:${item.source}`]: rank },
    localRelevance: item.localRelevance ?? item.relevanceFallback ?? 0,
    freshness: item.freshness ?? 0,
    engagement: item.engagementScore,
    sourceQuality: item.sourceQuality ?? 0.6,
    rrfScore: score,
    sources: [item.source],
    sourceItems: [item],
  }
}

// Fuse the ranked per-(subquery, source) streams into one candidate pool of at
// most `poolLimit` items. `streams` is keyed via `streamKeyOf(label, source)`.
export function weightedRrf(
  streams: Map<string, SourceItem[]>,
  plan: QueryPlan,
  poolLimit: number,
): Candidate[] {
  const subqueriesByLabel = new Map(
    plan.subqueries.map(subquery => [subquery.label, subquery]),
  )
  const candidates = new Map<string, Candidate>()
  // Per candidate, the (source, itemId) pairs already merged in — O(1) dedup.
  const seenSourceItems = new Map<string, Set<string>>()

  for (const [streamKey, items] of streams) {
    const { label, source: sourceName } = parseStreamKey(streamKey)
    const subquery = subqueriesByLabel.get(label)
    if (!subquery) {
      continue
    }
    const weight = subquery.weight * (plan.sourceWeights[sourceName] ?? 1)

    let rank = 0
    for (let i = 0, { length } = items; i < length; i += 1) {
      const item = items[i]!
      rank += 1
      const key = candidateKey(item)
      const score = weight / (RRF_K + rank)
      const itemRelevance = item.localRelevance ?? item.relevanceFallback ?? 0
      const itemFreshness = item.freshness ?? 0
      const itemSourceQuality = item.sourceQuality ?? 0.6

      const existing = candidates.get(key)
      if (!existing) {
        candidates.set(key, makeCandidate(key, item, label, rank, score))
        seenSourceItems.set(key, new Set([candidateSourceItemKey(item)]))
        continue
      }

      existing.rrfScore += score
      const previousPrimary = primaryScore(
        existing.localRelevance,
        existing.freshness,
        existing.sourceQuality,
      )
      const incomingPrimary = primaryScore(
        itemRelevance,
        itemFreshness,
        itemSourceQuality,
      )
      existing.localRelevance = Math.max(existing.localRelevance, itemRelevance)
      existing.freshness = Math.max(existing.freshness, itemFreshness)
      if (existing.engagement === undefined) {
        existing.engagement = item.engagementScore
      } else if (item.engagementScore !== undefined) {
        existing.engagement = Math.max(
          existing.engagement,
          item.engagementScore,
        )
      }
      existing.sourceQuality = Math.max(
        existing.sourceQuality,
        itemSourceQuality,
      )
      existing.nativeRanks[`${label}:${item.source}`] = rank
      if (!existing.subqueryLabels.includes(label)) {
        existing.subqueryLabels.push(label)
      }
      if (!existing.sources.includes(item.source)) {
        existing.sources.push(item.source)
      }
      const sourceItemKey = candidateSourceItemKey(item)
      const seen = seenSourceItems.get(key)!
      if (!seen.has(sourceItemKey)) {
        seen.add(sourceItemKey)
        existing.sourceItems.push(item)
      }
      // Promote the merged candidate's display fields to the stronger item.
      if (incomingPrimary > previousPrimary) {
        existing.itemId = item.itemId
        existing.source = item.source
        existing.title = item.title
        existing.snippet = item.snippet
      }
      // Prefer the longer snippet regardless of which item won the display.
      if (existing.snippet.split(' ').length < item.snippet.split(' ').length) {
        existing.snippet = item.snippet
      }
    }
  }

  // oxlint-disable-next-line unicorn/no-array-sort -- the spread of candidates.values() already copies into a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  const fused = [...candidates.values()].sort(compareCandidates)
  return diversifyPool(applyPerAuthorCap(fused), poolLimit)
}

// Per-candidate dedup key for a merged source item (distinct from the cross-item
// candidate key — this one identifies the exact item within a candidate).
function candidateSourceItemKey(item: SourceItem): string {
  return `${item.source}:${item.itemId}`
}
