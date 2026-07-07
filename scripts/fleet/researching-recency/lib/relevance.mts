/**
 * @file Query-centric token-overlap relevance scoring, ported from the upstream
 *   last30days `relevance.py`. The score is deliberately query-centric: exact
 *   phrase matches score very high, partial matches pay a meaningful penalty,
 *   and matches on generic words alone ("review", "guide") stay below the
 *   relevance filter threshold. The synonym table carries the programming
 *   aliases (js/javascript, ts/typescript, react/reactjs, …) that cause most
 *   token-overlap misses on a dev corpus.
 *   Lock-step with: last30days `relevance.py` (token-overlap math; keep scoring
 *   coefficients identical so ranking parity holds against the reference).
 */

import type { PreparedQuery } from './types.mts'

// Common English words that dilute token overlap; dropped before scoring.
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'are',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'for',
  'from',
  'get',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'so',
  'that',
  'the',
  'this',
  'to',
  'was',
  'we',
  'what',
  'will',
  'with',
  'you',
  'your',
])

// Bidirectional synonym groups: a query token expands to its aliases so a
// search for "typescript" still matches a title that only says "ts". Trimmed
// to the programming aliases relevant to the fleet variant.
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  ai: ['artificial', 'intelligence'],
  javascript: ['js'],
  js: ['javascript'],
  ml: ['machine', 'learning'],
  react: ['reactjs'],
  reactjs: ['react'],
  svelte: ['sveltejs'],
  sveltejs: ['svelte'],
  ts: ['typescript'],
  typescript: ['ts'],
  vue: ['vuejs'],
  vuejs: ['vue'],
}

// Generic query words that should not carry relevance on their own. They still
// help when paired with a stronger entity/topic match.
export const LOW_SIGNAL_QUERY_TOKENS: ReadonlySet<string> = new Set([
  'advice',
  'best',
  'code',
  'compare',
  'comparison',
  'differences',
  'explain',
  'guide',
  'guides',
  'how',
  'latest',
  'news',
  'opinion',
  'opinions',
  'rate',
  'review',
  'reviews',
  'thoughts',
  'tip',
  'tips',
  'tutorial',
  'tutorials',
  'update',
  'updates',
  'use',
  'using',
  'versus',
  'vs',
  'worth',
])

// Replace every non-word, non-space char with a space, lowercase, and split on
// whitespace. Mirrors the upstream `re.sub(r'[^\w\s]', ' ', text.lower())`.
// JS `\w` is ASCII-only, which matches the upstream behavior for the Latin
// programming-token corpus this scores.
function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0)
}

// Lowercase, strip punctuation, drop stopwords + single-char tokens, then
// expand with synonyms for cross-alias matching.
export function tokenize(text: string): Set<string> {
  const words = splitWords(text)
  const tokens = new Set<string>()
  for (const word of words) {
    if (word.length > 1 && !STOPWORDS.has(word)) {
      tokens.add(word)
    }
  }
  const expanded = new Set(tokens)
  for (const token of tokens) {
    // Object.hasOwn guards against a token like "constructor"/"toString"
    // resolving to an Object.prototype member (a non-iterable function)
    // instead of a real synonym entry.
    if (Object.hasOwn(SYNONYMS, token)) {
      for (const alias of SYNONYMS[token]!) {
        expanded.add(alias)
      }
    }
  }
  return expanded
}

// Normalize text for phrase-containment checks: collapse punctuation to spaces,
// squeeze runs of whitespace, trim.
export function normalizePhrase(text: string): string {
  return splitWords(text).join(' ')
}

// Build the reusable query shape once per ranking query.
export function prepareQuery(query: string): PreparedQuery {
  const queryTokens = tokenize(query)
  const informative = new Set<string>()
  for (const token of queryTokens) {
    if (!LOW_SIGNAL_QUERY_TOKENS.has(token)) {
      informative.add(token)
    }
  }
  return {
    raw: query,
    queryTokens,
    // Fall back to the full token set when the query is all low-signal words,
    // so an all-generic query still scores against itself.
    informativeQueryTokens: informative.size > 0 ? informative : queryTokens,
    normalizedPhrase: normalizePhrase(query),
  }
}

function asPrepared(query: PreparedQuery | string): PreparedQuery {
  return typeof query === 'string' ? prepareQuery(query) : query
}

function intersectionSize(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let count = 0
  for (const token of left) {
    if (right.has(token)) {
      count += 1
    }
  }
  return count
}

function hasIntersection(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  for (const token of left) {
    if (right.has(token)) {
      return true
    }
  }
  return false
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

// Compute a query-centric relevance score in [0, 1]. The score combines query
// coverage, informative-token coverage, a small precision term penalizing
// extra noise, and an exact-phrase bonus. Generic-token-only matches are capped
// below the relevance filter threshold. Empty/stopword-only queries return 0.5.
export function tokenOverlapRelevance(
  query: PreparedQuery | string,
  text: string,
  hashtags?: readonly string[] | undefined,
): number {
  const prepared = asPrepared(query)
  const queryTokens = prepared.queryTokens

  let combined = text
  if (hashtags && hashtags.length > 0) {
    combined = `${text} ${hashtags.join(' ')}`
  }
  const textTokens = tokenize(combined)

  // Split concatenated hashtags ("claudecode" matches query token "claude").
  if (hashtags) {
    for (const tag of hashtags) {
      const tagLower = tag.toLowerCase()
      for (const queryToken of queryTokens) {
        if (queryToken !== tagLower && tagLower.includes(queryToken)) {
          textTokens.add(queryToken)
        }
      }
    }
  }

  if (queryTokens.size === 0) {
    return 0.5
  }

  const overlap = intersectionSize(queryTokens, textTokens)
  if (overlap === 0) {
    return 0
  }

  const informativeQueryTokens = prepared.informativeQueryTokens
  const coverage = overlap / queryTokens.size
  const informativeOverlap =
    intersectionSize(informativeQueryTokens, textTokens) /
    informativeQueryTokens.size
  const precisionDenominator =
    Math.min(textTokens.size, queryTokens.size + 4) || 1
  const precision = overlap / precisionDenominator

  let phraseBonus = 0
  const normalizedQuery = prepared.normalizedPhrase
  const normalizedText = normalizePhrase(combined)
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) {
    phraseBonus = normalizedQuery.split(' ').length > 1 ? 0.12 : 0.16
  }

  const base =
    0.55 * coverage ** 1.35 + 0.25 * informativeOverlap + 0.2 * precision

  // Only generic words matched: keep the score below the relevance filter
  // threshold so these don't survive by default.
  if (
    informativeQueryTokens.size > 0 &&
    !hasIntersection(informativeQueryTokens, textTokens)
  ) {
    return roundTo2(Math.min(0.24, base))
  }

  return roundTo2(Math.min(1, base + phraseBonus))
}
