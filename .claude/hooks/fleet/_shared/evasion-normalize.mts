// Evasion-normalization shared across the AI-config / prompt-injection guards:
// strip invisible Unicode + fold homoglyphs before scanning, and label
// invisible-Unicode smuggling channels. One source so the homoglyph table and
// channel labels can't drift between the two guards that defeat obfuscated
// payloads, was a hand-synced inline copy in each.

// Invisible / format characters with no legitimate use in the prose or
// source we author: soft hyphen, zero-width space/non-joiner/joiner,
// word joiner, the various bidi controls and isolates, the invisible
// math operators, and the BOM / zero-width no-break space.
const INVISIBLE_RE = /[­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g

// Confusables that render as an ASCII letter. Keyed lowercase — callers fold
// after lowercasing, and Cyrillic/Greek case mapping reaches these from their
// capitals. Kept to letters with a near-identical glyph in a common UI font;
// a merely similar letter would trade a real evasion for false positives on
// legitimate non-Latin prose.
const HOMOGLYPHS: ReadonlyMap<string, string> = new Map([
  ['а', 'a'],
  ['е', 'e'],
  ['о', 'o'],
  ['с', 'c'],
  ['р', 'p'],
  ['х', 'x'],
  ['у', 'y'],
  ['ѕ', 's'],
  ['і', 'i'],
  ['ј', 'j'],
  ['ο', 'o'],
  ['ι', 'i'],
  ['ӏ', 'l'],
  ['ⅼ', 'l'],
  ['ｌ', 'l'],
  ['ԝ', 'w'],
  ['ѡ', 'w'],
  ['ь', 'b'],
  ['һ', 'h'],
  ['υ', 'u'],
  ['ս', 'u'],
  ['ԁ', 'd'],
  ['ԛ', 'q'],
  ['α', 'a'],
  ['ν', 'v'],
  ['ϲ', 'c'],
  ['ѐ', 'e'],
  ['ԑ', 'e'],
])

// require-regex-comment: numeric HTML character references, decimal and hex.
// Only the ASCII printable range is decoded (see decodeAsciiNumericEntities).
const NUMERIC_ENTITY_RE = /&#(?<hex>x)?(?<digits>[0-9a-f]{1,6});/gi

// require-regex-comment: markup that can interrupt a word yet vanish when the
// surface renders — markdown emphasis / code / strikethrough delimiters and
// HTML comments. `_` is absent on purpose: CommonMark forbids intra-word `_`
// emphasis, so `A_llow_` renders literally and never reads as the word.
const MARKUP_RUN = String.raw`(?:<!--[\s\S]*?-->|[*\`~]+)`

// require-regex-comment: a markup run with a word character on BOTH sides —
// the signature of a word deliberately split by markup.
const INTRA_WORD_MARKUP_RE = new RegExp(`(?<=\\w)${MARKUP_RUN}(?=\\w)`)

// require-regex-comment: a markup run touching a word on EITHER side. Applied
// only once an intra-word split proves the markup is a split rather than a
// span around a whole phrase.
const WORD_ADJACENT_MARKUP_RE = new RegExp(
  `(?<=\\w)${MARKUP_RUN}|${MARKUP_RUN}(?=\\w)`,
  'g',
)

// require-regex-comment: non-spacing combining marks, dropped after an NFD
// decomposition so `Állow` and `A` + U+0301 both reduce to `Allow`.
const COMBINING_MARK_RE = /\p{Mn}/gu

/**
 * Decode numeric HTML character references to the ASCII printable character
 * they render as. Restricted to `U+0020`–`U+007E`: a markdown or HTML surface
 * renders `&#65;llow` as the plain word, so the reference is a spelling of the
 * letter rather than data. Anything outside that range is left as written —
 * decoding arbitrary code points invites more surprise than it prevents.
 */
export function decodeAsciiNumericEntities(text: string): string {
  if (!text.includes('&#')) {
    return text
  }
  return text.replace(NUMERIC_ENTITY_RE, (whole, ...args) => {
    const groups = args[args.length - 1] as {
      digits?: string | undefined
      hex?: string | undefined
    }
    const code = Number.parseInt(groups.digits ?? '', groups.hex ? 16 : 10)
    return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : whole
  })
}

/**
 * Remove markup that splits a word so the text reads as the surface renders
 * it: `A*llow*` and ``A`llow` `` both become `Allow`.
 *
 * Gated on an intra-word split being present. Without that gate a code span
 * wrapping a WHOLE phrase (`` `Allow …` ``) would lose its delimiters, and
 * the use-vs-mention allowance that lets docs quote a phrase depends on those
 * delimiters surviving. A word split down the middle is never formatting.
 */
export function collapseIntraWordMarkup(text: string): string {
  if (!INTRA_WORD_MARKUP_RE.test(text)) {
    return text
  }
  return text.replace(WORD_ADJACENT_MARKUP_RE, '')
}

/**
 * Drop combining marks so an accented spelling folds to its base letters.
 * Distinct from NFKC, which recomposes rather than removes them.
 */
export function stripCombiningMarks(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARK_RE, '')
}

// Strip invisible chars + Unicode Tag-block codepoints, fold homoglyphs.
// Iterating by code point (for…of) handles the astral Tag block.
export function normalizeForScan(text: string): string {
  const stripped = text.replace(INVISIBLE_RE, '')
  let out = ''
  for (const ch of stripped) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0xe_00_00 && cp <= 0xe_00_7f) {
      continue
    }
    out += HOMOGLYPHS.get(ch) ?? ch
  }
  return out
}

// Returns a label when the text carries an invisible-Unicode smuggling
// channel that has no legitimate use in our sources/docs: Tag-block
// chars, bidi overrides, or a run of zero-width characters.
export function invisibleSmugglingLabel(text: string): string | undefined {
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp >= 0xe_00_00 && cp <= 0xe_00_7f) {
      return 'Unicode Tag-block character (invisible text-smuggling channel)'
    }
  }
  if (/[‪-‮⁦-⁩]/.test(text)) {
    return 'Unicode bidi override (visible-text reordering channel)'
  }
  if (/[​-‍⁠﻿]{3,}/.test(text)) {
    return 'run of zero-width characters (text-smuggling channel)'
  }
  return undefined
}
