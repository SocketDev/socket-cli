/**
 * @file The `--emit=compact` renderer: the badge line, an evidence envelope the
 *   model reads and transforms into prose, and the pass-through footer. The
 *   envelope lists the fused candidates with their scores, source, engagement,
 *   and snippet — enough for the model to cluster + synthesize, bounded by the
 *   EVIDENCE markers so the model knows not to dump it verbatim.
 */

import { BADGE_PREFIX, EVIDENCE_CLOSE, EVIDENCE_OPEN } from '../markers.mts'
import { renderFooter } from './footer.mts'

import type { Candidate, SourceResult } from '../types.mts'

// The badge is the brief's mandatory first line; `syncedDate` is an ISO date
// (YYYY-MM-DD) the CLI stamps from `now`.
export function renderBadge(syncedDate: string): string {
  return `${BADGE_PREFIX} · synced ${syncedDate}`
}

// A compact one-line engagement summary for a candidate, e.g. "186 points, 122
// comments". Empty when the source carries no counts (Reddit RSS, web).
function engagementSummary(candidate: Candidate): string {
  const item = candidate.sourceItems[0]
  if (!item) {
    return ''
  }
  const parts: string[] = []
  for (const [field, value] of Object.entries(item.engagement)) {
    if (value > 0) {
      parts.push(`${value} ${field}`)
    }
  }
  return parts.join(', ')
}

// One evidence row: rank, title (linked), source + container, engagement, date,
// and the snippet. The model reads these; it does not echo them verbatim.
function evidenceRow(candidate: Candidate, index: number): string {
  const engagement = engagementSummary(candidate)
  // `container` ("Hacker News", "r/rust", …) and the publish date live on the
  // merged source item, not the candidate.
  const item = candidate.sourceItems[0]
  const container = item?.container ?? candidate.source
  const meta = [
    container,
    item?.publishedAt?.slice(0, 10),
    engagement || undefined,
  ]
    .filter(part => part)
    .join(' · ')
  const lines = [
    `### ${index + 1}. [${candidate.title}](${candidate.url})`,
    `${meta} (relevance ${candidate.localRelevance.toFixed(2)}, score ${candidate.rrfScore.toFixed(4)})`,
  ]
  if (candidate.snippet && candidate.snippet !== candidate.title) {
    lines.push('', candidate.snippet.slice(0, 400))
  }
  return lines.join('\n')
}

// Render the full compact output: badge, a date-range + active-source line, the
// bounded evidence envelope of ranked candidates, and the pass-through footer.
export function renderCompact(options: {
  candidates: readonly Candidate[]
  results: readonly SourceResult[]
  topic: string
  syncedDate: string
  fromDate: string
  savedPath: string
}): string {
  const { candidates, fromDate, results, savedPath, syncedDate, topic } = {
    __proto__: null,
    ...options,
  } as typeof options
  const activeSources = results
    .filter(result => result.status === 'ok')
    .map(result => result.source)
  const rows = candidates.map((candidate, index) =>
    evidenceRow(candidate, index),
  )
  return [
    renderBadge(syncedDate),
    '',
    `Topic: ${topic}`,
    `Window: ${fromDate} to ${syncedDate} · active sources: ${activeSources.join(', ') || 'none'}`,
    '',
    EVIDENCE_OPEN,
    '',
    '## Ranked Evidence Clusters',
    '',
    rows.join('\n\n'),
    '',
    EVIDENCE_CLOSE,
    '',
    renderFooter(results, savedPath),
  ].join('\n')
}
