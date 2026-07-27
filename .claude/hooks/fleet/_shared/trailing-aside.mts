// Shared detector for "extra bits" trailing parenthetical asides: a short line
// (a manifest description, a heading) that ends with a parenthetical re-listing
// detail the line already implies. The tell is a LIST inside the trailing
// parens — items joined by a comma, ` + `, ` / `, or ` and ` — or a long aside
// of five or more words. A short qualifier like "(experimental)" or
// "(RFC 8259)" stays allowed.

const LISTY_SEPARATOR_RE = /,|\s\+\s|\s\/\s|\sand\s/i

const TRAILING_ASIDE_RE = /\(([^()]+)\)$/

// A Markdown heading (ATX, `#` … `######`) ending with a listy parenthetical.
// Tuned tighter than the value-level detector to stay off common headings: it
// fires only on ` + `, ` / `, or a two-comma list, so "## Setup (Linux, macOS)"
// passes while "## Features (bulk, live, offline)" and "## Modes (a + b)" do not.
export const HEADING_LISTY_ASIDE_RE =
  /^#{1,6} .*\((?:[^()\n]*(?:\s\+\s|\s\/\s)[^()\n]*|[^()\n]*,[^()\n]*,[^()\n]*)\)\s*$/im

// Returns the offending aside text when `value`, after trailing punctuation is
// trimmed, ends with a listy parenthetical; otherwise undefined.
export function trailingListyAside(value: string): string | undefined {
  const trimmed = value.trim().replace(/[.\s]+$/, '')
  const match = TRAILING_ASIDE_RE.exec(trimmed)
  if (!match) {
    return undefined
  }
  const inner = match[1]!.trim()
  const wordCount = inner.split(/\s+/).filter(Boolean).length
  if (LISTY_SEPARATOR_RE.test(inner) || wordCount >= 5) {
    return inner
  }
  return undefined
}
