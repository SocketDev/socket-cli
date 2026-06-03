/**
 * @file Runtime payload builders for the prompt-injection-guard tests. The
 *   guard exists to keep prompt-injection directives and agent
 *   denial-of-service content out of our source tree. Storing real attack
 *   strings as literals — even in this self-exempt test directory — would put
 *   exactly that content in the tree. Instead every hostile payload is
 *   ASSEMBLED HERE at runtime from harmless fragments, `String.fromCodePoint`,
 *   and `.repeat`, so the dangerous bytes exist only while the test runs and
 *   nothing scannable sits on disk.
 */

// Join word fragments into one token: joinWords(['dis', 'regard']) →
// 'disregard'. Splitting a flagged keyword across array elements keeps the
// whole word out of the source while reconstructing it at runtime.
export function joinWords(parts: readonly string[]): string {
  return parts.join('')
}

// Swap Latin a/e for their Cyrillic homoglyphs (U+0430 / U+0435) so the
// word reads identically to a human but trips the normalizer's fold.
export function cyrillic(word: string): string {
  const a = String.fromCodePoint(0x0430)
  const e = String.fromCodePoint(0x0435)
  return word.replace(/a/g, a).replace(/e/g, e)
}

// A single zero-width space (U+200B).
export function zeroWidthSpace(): string {
  return String.fromCodePoint(0x200b)
}

// A run of distinct zero-width characters (ZWSP, ZWNJ, ZWJ, word-joiner)
// long enough to trip the zero-width-run detector.
export function zeroWidthRun(): string {
  return [0x200b, 0x200c, 0x200d, 0x2060]
    .map(cp => String.fromCodePoint(cp))
    .join('')
}

// A run of combining diacritical marks (U+0301) on its own — caller
// prepends a base character.
export function combiningRun(count: number): string {
  return String.fromCodePoint(0x0301).repeat(count)
}

// A bidi RIGHT-TO-LEFT OVERRIDE (U+202E).
export function bidiOverride(): string {
  return String.fromCodePoint(0x202e)
}

// A few Unicode Tag-block codepoints (U+E0041 etc.) — an invisible
// text-smuggling channel.
export function tagBlock(): string {
  return [0xe0041, 0xe0049, 0xe0020]
    .map(cp => String.fromCodePoint(cp))
    .join('')
}

// ESC (U+001B) + CSI erase-line, hidden from a human terminal.
export function ansiErase(): string {
  const esc = String.fromCodePoint(0x1b)
  return `${esc}[2K\r`
}

// ESC + SGR conceal (code 8).
export function ansiSgrConceal(): string {
  const esc = String.fromCodePoint(0x1b)
  return `${esc}[8m`
}

// A fake closing role tag (the kind used to forge a chat-template
// boundary), assembled from fragments so the whole tag never appears in
// source.
export function fakeSystemTag(): string {
  return `</${joinWords(['sys', 'tem'])}>`
}

// A catastrophic-backtracking regex literal, assembled so the
// nested-quantifier shape is never authored verbatim — a quantified
// group is itself quantified, the classic ReDoS structure, with both
// quantifiers concatenated at runtime.
export function redosLiteral(): string {
  const plus = '+'
  const group = `(a${plus})`
  return `/^${group}${plus}$/`
}

// A billion-laughs-shaped XML entity-expansion document, assembled from
// fragments so the bomb body isn't stored whole.
export function entityBomb(): string {
  const entity = joinWords(['<!EN', 'TITY'])
  const refs = `${'&b;'.repeat(4)}`
  return `<?xml version="1.0"?>\n<!DOCTYPE x [\n${entity} a "${refs}">\n]>\n`
}
