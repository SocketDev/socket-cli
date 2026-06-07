/**
 * @file Query-plan validation. The model builds the plan JSON (which sources to
 *   search, with what queries, at what weights) and the engine fuses over it.
 *   `validatePlan` turns loosely-typed parsed JSON into a typed `QueryPlan`,
 *   failing with a what/where/saw-vs-wanted/fix message the model can act on,
 *   and `normalizePlan` fills sane defaults so a thin plan still runs.
 */

import { joinOr } from '@socketsecurity/lib-stable/arrays/join'

import type {
  FreshnessMode,
  QueryPlan,
  SourceName,
  SubQuery,
} from './types.mts'

// Every source the engine knows how to fetch. A plan may name a subset.
export const ALL_SOURCES: readonly SourceName[] = [
  'bluesky',
  'devto',
  'github',
  'hackernews',
  'lobsters',
  'reddit',
  'web',
  'x',
]

const FRESHNESS_MODES: readonly FreshnessMode[] = [
  'balancedRecent',
  'evergreenOk',
  'strictRecent',
]

// Sources usable with no credentials. The opt-in sources (bluesky) are skipped
// at fetch time when their env vars are absent; they stay valid in a plan.
export const KEYLESS_SOURCES: readonly SourceName[] = [
  'devto',
  'github',
  'hackernews',
  'lobsters',
  'reddit',
  'web',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSourceName(value: unknown): value is SourceName {
  return typeof value === 'string' && ALL_SOURCES.includes(value as SourceName)
}

// Validate a single subquery at `path` (e.g. `subqueries[0]`). Returns the typed
// SubQuery or throws a fix-it error.
function validateSubQuery(raw: unknown, path: string): SubQuery {
  if (!isRecord(raw)) {
    throw new Error(
      `Plan ${path} must be an object with label/searchQuery/sources; saw ${typeof raw}. Provide a subquery object.`,
    )
  }
  const { label, rankingQuery, searchQuery, sources, weight } = raw
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(
      `Plan ${path}.label must be a non-empty string; saw ${JSON.stringify(label)}. Add a unique slug label (no spaces).`,
    )
  }
  if (label.includes(' ')) {
    throw new Error(
      `Plan ${path}.label must not contain spaces (it keys the fusion streams); saw ${JSON.stringify(label)}. Use a hyphenated slug.`,
    )
  }
  if (typeof searchQuery !== 'string' || searchQuery.trim() === '') {
    throw new Error(
      `Plan ${path}.searchQuery must be a non-empty string; saw ${JSON.stringify(searchQuery)}. Add the text each source searches for.`,
    )
  }
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(
      `Plan ${path}.sources must be a non-empty array; saw ${JSON.stringify(sources)}. List one or more of ${joinOr([...ALL_SOURCES])}.`,
    )
  }
  for (let i = 0, { length } = sources; i < length; i += 1) {
    if (!isSourceName(sources[i])) {
      throw new Error(
        `Plan ${path}.sources[${i}] is not a known source; saw ${JSON.stringify(sources[i])}. Use one of ${joinOr([...ALL_SOURCES])}.`,
      )
    }
  }
  if (weight !== undefined && (typeof weight !== 'number' || weight <= 0)) {
    throw new Error(
      `Plan ${path}.weight must be a positive number when present; saw ${JSON.stringify(weight)}. Omit it to default to 1, or pass a value > 0.`,
    )
  }
  return {
    label,
    searchQuery,
    // The ranking query defaults to the search query when the model omits it.
    rankingQuery:
      typeof rankingQuery === 'string' && rankingQuery.trim() !== ''
        ? rankingQuery
        : searchQuery,
    sources: sources as SourceName[],
    weight: typeof weight === 'number' ? weight : 1,
  }
}

// Validate parsed plan JSON into a typed QueryPlan, filling defaults for the
// optional fields. `rawTopic` is the user's original query, threaded in by the
// CLI so the plan records what it was built for.
export function validatePlan(raw: unknown, rawTopic: string): QueryPlan {
  if (!isRecord(raw)) {
    throw new Error(
      `Plan must be a JSON object; saw ${typeof raw}. Provide { subqueries: [...] }.`,
    )
  }
  const { freshnessMode, intent, notes, sourceWeights, subqueries } = raw
  if (!Array.isArray(subqueries) || subqueries.length === 0) {
    throw new Error(
      `Plan.subqueries must be a non-empty array; saw ${JSON.stringify(subqueries)}. Add at least one subquery.`,
    )
  }
  if (
    freshnessMode !== undefined &&
    !FRESHNESS_MODES.includes(freshnessMode as FreshnessMode)
  ) {
    throw new Error(
      `Plan.freshnessMode must be one of ${joinOr([...FRESHNESS_MODES])}; saw ${JSON.stringify(freshnessMode)}. Omit it to default to balancedRecent.`,
    )
  }
  if (sourceWeights !== undefined && !isRecord(sourceWeights)) {
    throw new Error(
      `Plan.sourceWeights must be an object of source->multiplier; saw ${typeof sourceWeights}. Omit it or pass e.g. { github: 1.2 }.`,
    )
  }

  const validatedSubqueries: SubQuery[] = []
  for (let i = 0, { length } = subqueries; i < length; i += 1) {
    validatedSubqueries.push(validateSubQuery(subqueries[i], `subqueries[${i}]`))
  }

  const labels = validatedSubqueries.map(subquery => subquery.label)
  const duplicate = labels.find(
    (label, index) => labels.indexOf(label) !== index,
  )
  if (duplicate !== undefined) {
    throw new Error(
      `Plan.subqueries labels must be unique (they key the fusion streams); saw a repeated ${JSON.stringify(duplicate)}. Rename one.`,
    )
  }

  return {
    intent: typeof intent === 'string' ? intent : 'overview',
    freshnessMode: (freshnessMode as FreshnessMode) ?? 'balancedRecent',
    rawTopic,
    subqueries: validatedSubqueries,
    sourceWeights: isRecord(sourceWeights)
      ? (sourceWeights as Record<string, number>)
      : {},
    notes: Array.isArray(notes)
      ? notes.filter((note): note is string => typeof note === 'string')
      : [],
  }
}

// Build the trivial single-subquery plan for a bare topic with no model plan —
// searches every requested source at equal weight.
export function defaultPlan(
  topic: string,
  sources: readonly SourceName[] = KEYLESS_SOURCES,
): QueryPlan {
  return {
    intent: 'overview',
    freshnessMode: 'balancedRecent',
    rawTopic: topic,
    subqueries: [
      {
        label: 'main',
        searchQuery: topic,
        rankingQuery: topic,
        sources: [...sources],
        weight: 1,
      },
    ],
    sourceWeights: {},
    notes: [],
  }
}
