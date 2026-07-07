/**
 * @file Within-source near-duplicate detection, ported from the upstream
 *   last30days `dedupe.py`. Collapses items whose title/body/author/container
 *   text is highly similar (character-trigram OR token Jaccard above a
 *   threshold), keeping the earlier — already better-ranked — item. Runs after
 *   `annotateStream` sorts a stream, before fusion.
 *   Lock-step with: last30days `dedupe.py` (similarity math + 0.7 default
 *   threshold; keep identical so dedup behavior matches the reference).
 */

import type { SourceItem } from './types.mts'

// Common English words dropped before token-Jaccard so shared filler doesn't
// inflate similarity. Matches the upstream dedupe stopword set.
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'by',
  'can',
  'do',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'that',
  'the',
  'this',
  'to',
  'what',
  'with',
])

// Lowercase, replace non-word/non-space chars with spaces, squeeze whitespace.
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ngramsOfNormalized(norm: string, n = 3): Set<string> {
  if (norm.length < n) {
    return norm ? new Set([norm]) : new Set()
  }
  const grams = new Set<string>()
  for (let index = 0; index <= norm.length - n; index += 1) {
    grams.add(norm.slice(index, index + n))
  }
  return grams
}

// Character n-grams of the normalized text (default trigrams).
export function getNgrams(text: string, n = 3): Set<string> {
  return ngramsOfNormalized(normalizeText(text), n)
}

// Jaccard similarity of two sets: |intersection| / |union|, 0 when either is
// empty.
export function jaccardSimilarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) {
    return 0
  }
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1
    }
  }
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

function tokensOf(normalized: string): Set<string> {
  const tokens = new Set<string>()
  for (const token of normalized.split(' ')) {
    if (token.length > 1 && !STOPWORDS.has(token)) {
      tokens.add(token)
    }
  }
  return tokens
}

// Token-set Jaccard over the two normalized texts.
export function tokenJaccard(textA: string, textB: string): number {
  return jaccardSimilarity(
    tokensOf(normalizeText(textA)),
    tokensOf(normalizeText(textB)),
  )
}

// The hybrid similarity used to decide a duplicate: the max of character-trigram
// Jaccard and token Jaccard. Trigrams catch reworded-but-overlapping titles;
// tokens catch reordered ones.
export function hybridSimilarity(textA: string, textB: string): number {
  return Math.max(
    jaccardSimilarity(getNgrams(textA), getNgrams(textB)),
    tokenJaccard(textA, textB),
  )
}

// Pre-computed text representations for fast repeated similarity checks across
// a stream (build once per item, compare many times).
export interface PreparedText {
  ngrams: Set<string>
  tokens: Set<string>
}

export function prepareText(raw: string): PreparedText {
  const norm = normalizeText(raw)
  return { ngrams: ngramsOfNormalized(norm), tokens: tokensOf(norm) }
}

export function preparedSimilarity(a: PreparedText, b: PreparedText): number {
  return Math.max(
    jaccardSimilarity(a.ngrams, b.ngrams),
    jaccardSimilarity(a.tokens, b.tokens),
  )
}

// The text an item is deduped on: title + body + author + container.
export function itemText(item: SourceItem): string {
  return [item.title, item.body, item.author ?? '', item.container ?? '']
    .filter(part => part)
    .join(' ')
    .trim()
}

// Remove near-duplicates, keeping the earlier (better-scored) item. Items with
// no dedup text pass through untouched. Threshold defaults to 0.7 — the
// upstream value that balances catching reposts against merging distinct items.
export function dedupeItems(
  items: SourceItem[],
  threshold = 0.7,
): SourceItem[] {
  const kept: SourceItem[] = []
  const keptPrepared: PreparedText[] = []
  for (let i = 0, { length } = items; i < length; i += 1) {
    const item = items[i]!
    const text = itemText(item)
    if (!text) {
      kept.push(item)
      continue
    }
    const prepared = prepareText(text)
    let isDuplicate = false
    for (
      let j = 0, { length: keptLength } = keptPrepared;
      j < keptLength;
      j += 1
    ) {
      if (preparedSimilarity(prepared, keptPrepared[j]!) >= threshold) {
        isDuplicate = true
        break
      }
    }
    if (!isDuplicate) {
      kept.push(item)
      keptPrepared.push(prepared)
    }
  }
  return kept
}
