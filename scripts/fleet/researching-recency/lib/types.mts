/**
 * @file Shared shapes for the researching-recency engine. Ported from the
 *   upstream last30days `schema.py` dataclasses, trimmed to the programming
 *   sources the fleet variant queries. Every shape is exported; privacy is by
 *   not importing, never by leaving a type unexported.
 */

// One fetched result from a single source, before fusion. `engagement` holds
// raw per-source counts (stars, points, comments, …); the scoring stage reads
// them by name. The `*Score`/`localRankScore` fields are populated by
// `annotateStream` in signals.mts and start as undefined.
export interface SourceItem {
  itemId: string
  source: SourceName
  title: string
  body: string
  url: string
  author?: string | undefined
  container?: string | undefined
  // ISO-8601 publish timestamp, or undefined when the source omits one.
  publishedAt?: string | undefined
  engagement: Record<string, number>
  snippet: string
  // A source-provided relevance prior in [0, 1], used by fusion only when
  // `annotateStream` hasn't run (e.g. a source that ranks its own results).
  // Defaults to 0.5-equivalent via the consumer's `?? 0` when absent.
  relevanceFallback?: number | undefined
  // Arbitrary per-source extras (hashtags, labels, top_comments, …).
  metadata: Record<string, unknown>
  // Populated by annotateStream:
  localRelevance?: number | undefined
  freshness?: number | undefined
  engagementScore?: number | undefined
  sourceQuality?: number | undefined
  localRankScore?: number | undefined
}

// The programming-source registry. The `--search=` flag restricts fan-out to a
// subset of these; the model's plan assigns each subquery a source list.
export type SourceName =
  | 'bluesky'
  | 'devto'
  | 'github'
  | 'hackernews'
  | 'lobsters'
  | 'reddit'
  | 'web'
  | 'x'

// Freshness weighting profile. `strictRecent` rewards only the newest items;
// `evergreenOk` flattens the curve so older-but-relevant items survive.
export type FreshnessMode = 'balancedRecent' | 'evergreenOk' | 'strictRecent'

// A prepared query reused across every item in a stream so the per-item scoring
// loop doesn't re-tokenize the same query N times. Built once by
// `prepareQuery` in relevance.mts.
export interface PreparedQuery {
  raw: string
  queryTokens: ReadonlySet<string>
  informativeQueryTokens: ReadonlySet<string>
  normalizedPhrase: string
}

// One row of a query plan: a search to run against a set of sources, with a
// weight that scales its reciprocal-rank contribution during fusion. The model
// supplies the plan; `validatePlan` in plan.mts checks its shape.
export interface SubQuery {
  // Stable identifier for the subquery, used as the RRF stream key.
  label: string
  // The string handed to each source adapter to fetch with.
  searchQuery: string
  // The string scored against each fetched item (often === searchQuery).
  rankingQuery: string
  sources: SourceName[]
  weight: number
}

// X-handle scoping for the x source. `allowed` restricts the X search to those
// accounts only (an allowlist); `excluded` searches all of X except them (a
// denylist). Mutually exclusive at the xAI API — allow wins when both are set.
// Each caps at 20 handles; bare (no leading @).
export interface XHandles {
  allowed?: readonly string[] | undefined
  excluded?: readonly string[] | undefined
}

// The full plan the model builds for a topic and the engine fuses over.
export interface QueryPlan {
  // Search shape hint (e.g. 'comparison', 'howTo', 'overview'); guides synthesis.
  intent: string
  freshnessMode: FreshnessMode
  rawTopic: string
  subqueries: SubQuery[]
  // Per-source multipliers applied on top of each subquery weight during fusion.
  sourceWeights: Record<string, number>
  notes: string[]
  // Optional X-handle allow/deny scoping for the x source.
  xHandles?: XHandles | undefined
}

// A fused candidate: one logical result, merged across every (subquery, source)
// stream that surfaced it. `rrfScore` is the reciprocal-rank-fusion total;
// `localRelevance`/`freshness`/`engagement` carry the best signal seen across
// the merged source items. Produced by `weightedRrf` in rank.mts.
export interface Candidate {
  candidateId: string
  itemId: string
  source: SourceName
  title: string
  url: string
  snippet: string
  subqueryLabels: string[]
  // Map of `<label>:<source>` -> native rank within that stream.
  nativeRanks: Record<string, number>
  localRelevance: number
  freshness: number
  engagement: number | undefined
  sourceQuality: number
  rrfScore: number
  sources: SourceName[]
  sourceItems: SourceItem[]
}

// Per-fetch knobs handed to every adapter: the look-back window and how many
// items to pull per stream (set by --depth). `now` is injected so fetches and
// scoring share one clock (and tests can pin it).
export interface FetchContext {
  days: number
  now: number
  perStream: number
  // Optional X-handle allow/deny, threaded from the plan to the x adapter.
  xHandles?: XHandles | undefined
}

// What a source adapter returns: the items it found, plus a status the footer
// reports. `skipped` carries a human reason (e.g. "no BSKY_APP_PASSWORD") so a
// missing credential degrades gracefully instead of failing the run.
export interface SourceResult {
  source: SourceName
  status: 'ok' | 'skipped' | 'error'
  items: SourceItem[]
  note?: string | undefined
}

// A source adapter: given a search string + context, return its items. Adapters
// never throw — they catch their own failures and return a `status: 'error'`
// result so one dead source can't sink the whole fan-out.
export interface SourceAdapter {
  source: SourceName
  // True when the adapter can run without credentials in the current env.
  isAvailable: () => boolean
  fetch: (searchQuery: string, context: FetchContext) => Promise<SourceResult>
}
