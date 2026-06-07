/**
 * @file Local per-item scoring signals, ported from the upstream last30days
 *   `signals.py` (and the `recency_score` helper from `dates.py`). Computes a
 *   freshness score, a per-source engagement score, an editorial source-quality
 *   weight, and fuses them with token-overlap relevance into a single
 *   `localRankScore`. Tailored to the programming sources the fleet variant
 *   queries: GitHub / Hacker News / Reddit / Lobsters / dev.to / Bluesky / web.
 *
 * Lock-step with: last30days `signals.py` (scoring coefficients + the
 * 0.65/0.25/0.10 local-rank blend; keep identical for ranking parity).
 */

import { prepareQuery, tokenOverlapRelevance } from './relevance.mts'

import type { FreshnessMode, PreparedQuery, SourceItem } from './types.mts'

// Editorial signal-to-noise weights. Web grounding is the 1.0 baseline;
// curated dev aggregators (HN, Lobsters) rank high; open social (Reddit, X-like
// feeds) is discounted for noise. Values match upstream where the source
// overlaps; new dev sources (lobsters, devto, github) are weighted by curation.
export const SOURCE_QUALITY: Readonly<Record<string, number>> = {
  bluesky: 0.66,
  devto: 0.7,
  github: 0.9,
  hackernews: 0.8,
  lobsters: 0.82,
  reddit: 0.6,
  web: 1.0,
  x: 0.68,
}

export function sourceQuality(source: string): number {
  return SOURCE_QUALITY[source] ?? 0.6
}

// Days between an ISO timestamp and now, or undefined when unparseable.
function daysAgo(dateStr: string | undefined, now: number): number | undefined {
  if (!dateStr) {
    return undefined
  }
  const parsed = Date.parse(dateStr)
  if (Number.isNaN(parsed)) {
    return undefined
  }
  return (now - parsed) / 86_400_000
}

// Recency score in [0, 100]: 0 days ago = 100, maxDays ago = 0, clamped.
// Unknown date gets the worst score; a future date is treated as today.
export function recencyScore(
  dateStr: string | undefined,
  now: number,
  maxDays = 30,
): number {
  const age = daysAgo(dateStr, now)
  if (age === undefined) {
    return 0
  }
  if (age < 0) {
    return 100
  }
  if (age >= maxDays) {
    return 0
  }
  return Math.trunc(100 * (1 - age / maxDays))
}

// Freshness score shaped by the plan's freshness mode. `strictRecent` returns
// the raw recency curve; `evergreenOk` flattens it (older items survive);
// `balancedRecent` is the default middle ground.
export function freshness(
  item: SourceItem,
  now: number,
  freshnessMode: FreshnessMode = 'balancedRecent',
): number {
  const score = recencyScore(item.publishedAt, now)
  if (freshnessMode === 'strictRecent') {
    return Math.trunc(score)
  }
  if (freshnessMode === 'evergreenOk') {
    return Math.trunc(score * 0.6 + 40)
  }
  return Math.trunc(score * 0.8 + 10)
}

// log1p of a count, with non-positive / non-finite values flooring to 0.
export function log1pSafe(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.log1p(value)
}

function engagementField(item: SourceItem, field: string): number {
  return log1pSafe(item.engagement[field])
}

function topCommentScore(item: SourceItem): number {
  const comments = item.metadata['topComments']
  if (!Array.isArray(comments) || comments.length === 0) {
    return 0
  }
  const first = comments[0]
  if (typeof first !== 'object' || first === null) {
    return 0
  }
  const score = (first as Record<string, unknown>)['score']
  return log1pSafe(typeof score === 'number' ? score : undefined)
}

// Per-source engagement weights: [field, weight] pairs summed over log1p
// counts. Reddit carves out a top-comment slot (handled in redditEngagement).
const ENGAGEMENT_WEIGHTS: Readonly<Record<string, ReadonlyArray<[string, number]>>> =
  {
    bluesky: [
      ['likes', 0.4],
      ['reposts', 0.3],
      ['replies', 0.2],
      ['quotes', 0.1],
    ],
    // dev.to "reactions" + comments stand in for likes/discussion.
    devto: [
      ['reactions', 0.6],
      ['comments', 0.4],
    ],
    // GitHub: star velocity dominates, then reactions + comment thread depth.
    github: [
      ['stars', 0.5],
      ['reactions', 0.3],
      ['comments', 0.2],
    ],
    hackernews: [
      ['points', 0.55],
      ['comments', 0.45],
    ],
    lobsters: [
      ['score', 0.6],
      ['comments', 0.4],
    ],
    // X: likes dominate, then reposts/replies; views are a weak signal.
    x: [
      ['likes', 0.5],
      ['reposts', 0.25],
      ['replies', 0.15],
      ['views', 0.1],
    ],
  }

function weightedEngagement(
  item: SourceItem,
  weights: ReadonlyArray<[string, number]>,
): number | undefined {
  const values = weights.map(
    ([field, weight]): [number, number] => [engagementField(item, field), weight],
  )
  if (!values.some(([value]) => value > 0)) {
    return undefined
  }
  return values.reduce((sum, [value, weight]) => sum + value * weight, 0)
}

function redditEngagement(item: SourceItem): number | undefined {
  const score = engagementField(item, 'score')
  const comments = engagementField(item, 'numComments')
  const ratio = Number(item.engagement['upvoteRatio'] ?? 0)
  const topComment = topCommentScore(item)
  if (!(comments || ratio || score || topComment)) {
    return undefined
  }
  return 0.5 * score + 0.35 * comments + 0.05 * (ratio * 10) + 0.1 * topComment
}

function genericEngagement(item: SourceItem): number | undefined {
  const logged = Object.values(item.engagement)
    .map(value => log1pSafe(value))
    .filter(value => value > 0)
  if (logged.length === 0) {
    return undefined
  }
  return logged.reduce((sum, value) => sum + value, 0) / logged.length
}

// Raw (un-normalized) engagement signal for one item, dispatched by source.
export function engagementRaw(item: SourceItem): number | undefined {
  if (item.source === 'reddit') {
    return redditEngagement(item)
  }
  const weights = ENGAGEMENT_WEIGHTS[item.source]
  if (weights) {
    return weightedEngagement(item, weights)
  }
  return genericEngagement(item)
}

// Min-max normalize a list of raw engagement values into [0, 100] integers.
// All-equal inputs map to 50; undefined inputs pass through as undefined.
export function normalize(
  values: ReadonlyArray<number | undefined>,
): Array<number | undefined> {
  const valid = values.filter((value): value is number => value !== undefined)
  if (valid.length === 0) {
    return values.map(() => undefined)
  }
  const low = Math.min(...valid)
  const high = Math.max(...valid)
  if (high - low < 1e-9) {
    return values.map(value => (value === undefined ? undefined : 50))
  }
  return values.map(value =>
    value === undefined
      ? undefined
      : Math.trunc(((value - low) / (high - low)) * 100),
  )
}

// Local relevance with source-specific floors: a project-mode GitHub item
// (fetched via --github-repo, relevant by construction) never scores below 0.8,
// so a low-token-diversity repo isn't pruned despite being the search target.
export function localRelevance(
  item: SourceItem,
  rankingQuery: PreparedQuery | string,
): number {
  const text = [item.title, item.body, item.snippet]
    .filter(part => part)
    .join('\n')
  const hashtags = Array.isArray(item.metadata['hashtags'])
    ? (item.metadata['hashtags'] as string[])
    : undefined
  let score = tokenOverlapRelevance(rankingQuery, text, hashtags)

  const labels = Array.isArray(item.metadata['labels'])
    ? (item.metadata['labels'] as string[])
    : []
  if (labels.includes('project-mode')) {
    score = Math.max(score, 0.8)
  }
  return score
}

// Attach local scoring metadata to every item and return them sorted by
// localRankScore (descending). The 0.65/0.25/0.10 blend weights relevance over
// freshness over engagement — matching upstream.
export function annotateStream(
  items: SourceItem[],
  rankingQuery: PreparedQuery | string,
  freshnessMode: FreshnessMode,
  now: number,
): SourceItem[] {
  const prepared =
    typeof rankingQuery === 'string' ? prepareQuery(rankingQuery) : rankingQuery
  const engagementScores = normalize(items.map(item => engagementRaw(item)))
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const engagementScore = engagementScores[index]
    item.localRelevance = localRelevance(item, prepared)
    item.freshness = freshness(item, now, freshnessMode)
    item.engagementScore = engagementScore
    item.sourceQuality = sourceQuality(item.source)
    item.localRankScore =
      0.65 * item.localRelevance +
      0.25 * (item.freshness / 100) +
      0.1 * ((engagementScore ?? 0) / 100)
  }
  return items.toSorted(
    (left, right) => (right.localRankScore ?? 0) - (left.localRankScore ?? 0),
  )
}
