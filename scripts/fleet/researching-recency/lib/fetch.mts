/**
 * @file Parallel fan-out across (subquery, source) pairs. Resolves each plan
 *   subquery's sources to their adapters, runs the fetches concurrently under a
 *   small cap (so the per-source rate limits aren't tripped), annotates each
 *   returned stream with local scores, and returns both the streams keyed for
 *   fusion and the per-source statuses the footer reports. One dead source
 *   can't sink the run — every adapter returns a status rather than throwing.
 */

import { annotateStream } from './signals.mts'
import { prepareQuery } from './relevance.mts'
import { streamKeyOf } from './rank.mts'
import { blueskyAdapter } from './sources/bluesky.mts'
import { devtoAdapter } from './sources/devto.mts'
import { githubAdapter } from './sources/github.mts'
import { hackernewsAdapter } from './sources/hackernews.mts'
import { lobstersAdapter } from './sources/lobsters.mts'
import { redditAdapter } from './sources/reddit.mts'
import { xAdapter } from './sources/x.mts'

import type {
  FetchContext,
  QueryPlan,
  SourceAdapter,
  SourceItem,
  SourceName,
  SourceResult,
} from './types.mts'

// The adapter registry. `web` is absent here — it's sourced from the model's
// --web-file by the CLI, not fetched, so it has no network adapter.
export const ADAPTERS: Readonly<Partial<Record<SourceName, SourceAdapter>>> = {
  bluesky: blueskyAdapter,
  devto: devtoAdapter,
  github: githubAdapter,
  hackernews: hackernewsAdapter,
  lobsters: lobstersAdapter,
  reddit: redditAdapter,
  x: xAdapter,
}

// Max adapter calls in flight at once. Small, because several sources rate-limit
// aggressively (GitHub unauthenticated is 10 req/min); the bound keeps the
// fan-out from tripping them.
const MAX_CONCURRENCY = 4

// Drop items whose token-overlap relevance to the ranking query is at or below
// this floor. The tag-feed sources (Lobsters, dev.to) return whole-feed content
// the query never touched; without a floor those zero-relevance items ride a
// source's reserved diversity slots into the pool as noise.
const MIN_RELEVANCE = 0.05

// What fetchAll returns: the per-(label, source) streams ready for fusion, and
// the per-source statuses the footer renders.
export interface FetchOutcome {
  streams: Map<string, SourceItem[]>
  results: SourceResult[]
}

interface FetchJob {
  label: string
  source: SourceName
  searchQuery: string
  rankingQuery: string
}

// Run `jobs` through `worker` with at most `limit` in flight at once.
async function runPooled<T, R>(
  jobs: readonly T[],
  limit: number,
  worker: (job: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: jobs.length })
  let next = 0
  async function pump(): Promise<void> {
    while (next < jobs.length) {
      const index = next
      next += 1
      results[index] = await worker(jobs[index]!)
    }
  }
  const runners = Array.from(
    { length: Math.min(limit, jobs.length) },
    () => pump(),
  )
  await Promise.all(runners)
  return results
}

// Expand the plan into one job per (subquery, source) pair that has a network
// adapter. The `web` source is skipped here — the CLI feeds it separately.
function jobsFromPlan(plan: QueryPlan): FetchJob[] {
  const jobs: FetchJob[] = []
  for (let i = 0, { length } = plan.subqueries; i < length; i += 1) {
    const subquery = plan.subqueries[i]!
    for (let j = 0, { length: srcCount } = subquery.sources; j < srcCount; j += 1) {
      const source = subquery.sources[j]!
      if (ADAPTERS[source]) {
        jobs.push({
          label: subquery.label,
          source,
          searchQuery: subquery.searchQuery,
          rankingQuery: subquery.rankingQuery,
        })
      }
    }
  }
  return jobs
}

// Fan out every (subquery, source) fetch, annotate each returned stream with
// local scores, and collect the streams + statuses. Streams are keyed via
// `streamKeyOf` so fusion can read the (label, source) pair back.
export async function fetchAll(
  plan: QueryPlan,
  context: FetchContext,
): Promise<FetchOutcome> {
  const jobs = jobsFromPlan(plan)
  const streams = new Map<string, SourceItem[]>()
  const results: SourceResult[] = []

  const jobResults = await runPooled(jobs, MAX_CONCURRENCY, async job => {
    const adapter = ADAPTERS[job.source]!
    const result = await adapter.fetch(job.searchQuery, context)
    return { job, result }
  })

  for (let i = 0, { length } = jobResults; i < length; i += 1) {
    const { job, result } = jobResults[i]!
    results.push(result)
    if (result.items.length > 0) {
      const annotated = annotateStream(
        result.items,
        prepareQuery(job.rankingQuery),
        plan.freshnessMode,
        context.now,
      ).filter(item => (item.localRelevance ?? 0) > MIN_RELEVANCE)
      if (annotated.length > 0) {
        streams.set(streamKeyOf(job.label, job.source), annotated)
      }
    }
  }

  return { streams, results }
}
