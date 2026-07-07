// Evasion-normalization shared across the AI-config / prompt-injection guards:
// strip invisible Unicode + fold homoglyphs before scanning, and label
// invisible-Unicode smuggling channels. One source so the homoglyph table and
// channel labels can't drift between the two guards that defeat obfuscated
// payloads (was a hand-synced inline copy in each).

// Invisible / format characters with no legitimate use in the prose or
// source we author: soft hyphen, zero-width space/non-joiner/joiner,
// word joiner, the various bidi controls and isolates, the invisible
// math operators, and the BOM / zero-width no-break space.
const INVISIBLE_RE = /[­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g

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
])

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
