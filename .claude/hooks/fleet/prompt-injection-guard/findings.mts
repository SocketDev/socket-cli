/*
 * @file The finding record every prompt-injection-guard detector emits, plus the
 *   two text helpers that shape it.
 *
 *   Shared by the injection-shape scan (`index.mts`) and the agent
 *   denial-of-service scan (`bombs.mts`) so both report one record type and one
 *   quoting style.
 */

export interface Finding {
  readonly label: string
  readonly line: number
  readonly source: string
}

// Longest quoted source line a finding may carry, so one finding can't flood
// the block message.
const MAX_SOURCE_LEN = 160

export function clipSource(s: string): string {
  return s.length > MAX_SOURCE_LEN ? `${s.slice(0, MAX_SOURCE_LEN - 3)}...` : s
}

// Best-effort: 1-based line in the original text where the first word of
// `fragment` appears. Falls back to line 1.
export function lineOfFirstWord(text: string, fragment: string): number {
  const firstWord = fragment.trim().split(/\s+/)[0]
  /* c8 ignore start - fragment is always a non-empty string at every call site; empty-firstWord path is unreachable */
  if (!firstWord) {
    return 1
  }
  /* c8 ignore stop */
  const idx = text.toLowerCase().indexOf(firstWord.toLowerCase())
  if (idx < 0) {
    return 1
  }
  return text.slice(0, idx).split('\n').length
}
