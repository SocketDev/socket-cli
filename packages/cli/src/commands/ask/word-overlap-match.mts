/**
 * Word-overlap-based command matching for `socket ask`.
 *
 * Extracted from handle-ask.mts to keep that file under the 1000-line cap. The
 * word-overlap matcher is the fast path: ~3KB of pure JavaScript with no ML
 * model. It loads a pre-computed semantic index from disk lazily and scores
 * each command's word list against the query using Jaccard similarity.
 *
 * If the best score clears WORD_OVERLAP_THRESHOLD, the matcher returns the
 * winning action; otherwise it returns null and the caller falls back to
 * pattern matching or the ONNX fallback.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import nlp from 'compromise'

import { getHome } from '@socketsecurity/lib-stable/env/home'

// Minimum Jaccard similarity for word-overlap matching to win.
const WORD_OVERLAP_THRESHOLD = 0.3

// Lazy-loaded ~3KB semantic index. `null` until loadSemanticIndex resolves.
type SemanticIndex = {
  commands?: Record<string, unknown> | undefined
}
let semanticIndex: SemanticIndex | undefined = undefined

/**
 * Extract meaningful words from text: lowercase, stripped of punctuation,
 * filtered to length > 2. Used both as the matcher's tokenizer and exposed as a
 * utility for tests.
 */
export function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

/**
 * Lazily load the pre-computed semantic index from disk. Returns null if HOME
 * is unset or the file is unreadable — both treated as "no index, fall through
 * to pattern matching" rather than fatal errors.
 */
export async function loadSemanticIndex() {
  if (semanticIndex) {
    return semanticIndex
  }

  try {
    const homeDir = getHome()
    if (!homeDir) {
      return undefined
    }
    const indexPath = path.join(
      homeDir,
      '.claude/skills/socket-cli/semantic-index.json',
    )

    const content = await fs.readFile(indexPath, 'utf-8')
    semanticIndex = JSON.parse(content)
    return semanticIndex
  } catch (_e) {
    // Semantic index not available — not a critical error.
    return undefined
  }
}

/**
 * Normalize query using NLP to handle variations in phrasing. Verbs become
 * infinitive ("fixing" → "fix"), nouns become singular ("vulnerabilities" →
 * "vulnerability"). Falls back to plain lowercase if compromise throws.
 */
export function normalizeQuery(query: string): string {
  try {
    const doc = nlp(query)
    doc.verbs().toInfinitive()
    doc.nouns().toSingular()
    return doc.out('text').toLowerCase()
    /* c8 ignore start - defensive fallback when compromise NLP library throws unexpectedly */
  } catch (_e) {
    return query.toLowerCase()
  }
  /* c8 ignore stop */
}

/**
 * Compute word overlap score between query and command using Jaccard
 * similarity: |intersection| / |union|. Returns 0 when both sides are empty.
 */
export function wordOverlap(
  queryWords: Set<string>,
  commandWords: string[],
): number {
  const commandSet = new Set(commandWords)
  const intersection = new Set([...queryWords].filter(w => commandSet.has(w)))
  const union = new Set([...queryWords, ...commandWords])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Score every command in the semantic index against the query and return the
 * best match if its score clears WORD_OVERLAP_THRESHOLD. Returns null when the
 * index isn't loaded, the query has no scoring tokens, or no command meets the
 * threshold.
 */
export async function wordOverlapMatch(query: string): Promise<
  | {
      action: string
      confidence: number
    }
  | undefined
> {
  const index = await loadSemanticIndex()
  if (!index || !index.commands) {
    return undefined
  }

  const queryWords = new Set(extractWords(query))
  if (queryWords.size === 0) {
    return undefined
  }

  let bestAction = ''
  let bestScore = 0

  for (const [commandName, commandData] of Object.entries(index.commands)) {
    if (
      !commandData ||
      typeof commandData !== 'object' ||
      !('words' in commandData) ||
      !Array.isArray(commandData.words)
    ) {
      continue
    }
    const score = wordOverlap(queryWords, commandData.words)
    if (score > bestScore) {
      bestScore = score
      bestAction = commandName
    }
  }

  if (bestScore < WORD_OVERLAP_THRESHOLD) {
    return undefined
  }

  return { action: bestAction, confidence: bestScore }
}
