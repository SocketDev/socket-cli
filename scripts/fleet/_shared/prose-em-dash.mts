/*
 * @file The pure em-dash analyzer behind
 *   `scripts/fleet/check/prose-em-dashes-are-absent.mts`: reduce a markdown
 *   line to its prose, find every U+2014 in it, render the caret report, and
 *   apply the fix. Nothing here touches the filesystem, git, or the logger;
 *   the check owns the walk and the verdict.
 *
 *   The rule is "no em-dash at all", not "no em-dash chains". On an outbound
 *   GitHub surface (a PR body, an issue comment, a release note) one dash
 *   already reads as an agent tell, so a single dash is a finding.
 *
 *   ONE fix, and it is mechanical: replace the em-dash with a plain hyphen and
 *   leave the spacing alone, so ` — ` becomes ` - ` and `3—5` becomes `3-5`.
 *   A menu of rewrites (colon, period, comma pair, parentheses) would make
 *   every fix a judgement call and every diff a re-read; a one-character
 *   substitution is reviewable at a glance and is what `--fix` applies.
 *
 *   What is NOT prose, and so never a finding: an inline code span, a fenced
 *   block, an HTML comment (a machine marker), and a `| — |` empty-value table
 *   cell. The code exemption is load-bearing rather than a nicety. The hook
 *   verdict format in `.claude/hooks/fleet/_shared/verdict.mts` documents the
 *   line the hooks actually emit, dash included, inside a code span; rewriting
 *   that dash would change hook OUTPUT, not prose.
 */

export const EM_DASH = '—'
export const EM_DASH_ALLOW_LINE = '<!-- prose-em-dash: allow -->'
export const EM_DASH_ALLOW_FILE = '<!-- prose-em-dash: allow-file -->'

// The one sanctioned rewrite. Mechanical on purpose: same spacing, one
// character swapped.
export const EM_DASH_FIX =
  'replace it with a plain hyphen, keeping the spacing (` — ` becomes ` - `)'

// Spans removed before matching: an inline code span, an HTML comment (a
// machine marker, not prose), and the dash inside a `| — |` table cell (an
// empty value, not an aside). Each is a pure DELETION so the surviving
// characters keep a 1-to-1 map back to their raw columns.
const STRIP_PATTERNS: readonly RegExp[] = [
  /`[^`]*`/,
  /<!--[\s\S]*?-->/,
  /(?<=\|)\s*—\s*(?=\||$)/,
]

// How much of a long line the report prints around the caret.
const WINDOW_WIDTH = 100

export interface Prose {
  // The raw 0-based column each surviving character came from.
  readonly columns: readonly number[]
  readonly text: string
}

export interface EmDashFinding {
  // 1-based column in the RAW line, so the caret lands under the real dash.
  readonly column: number
  readonly line: number
  readonly text: string
}

/**
 * The line reduced to its prose, with a column map back to the raw line. A
 * dash inside an inline code span, an HTML comment, or an empty table cell is
 * not prose, so it must not count as a finding. Pure.
 *
 * Each pattern is stripped to a FIXED POINT, because deleting an inner match
 * splices its neighbours into a fresh one. Stripping the comment from
 * `a <!-<!-- z -->- b — c -->` leaves `a <!-- b — c -->`, a live comment whose
 * dash would then read as prose. Every pass strictly shortens the string, so
 * the loop always terminates.
 */
export function toProse(line: string): Prose {
  let text = line
  const columns: number[] = []
  for (let i = 0, { length } = line; i < length; i += 1) {
    columns.push(i)
  }
  for (let i = 0, { length } = STRIP_PATTERNS; i < length; i += 1) {
    const pattern = STRIP_PATTERNS[i]!
    for (;;) {
      const match = pattern.exec(text)
      if (!match?.[0]) {
        break
      }
      const { index } = match
      const width = match[0].length
      text = text.slice(0, index) + text.slice(index + width)
      columns.splice(index, width)
    }
  }
  return { columns, text }
}

/**
 * The RAW 0-based columns of every em-dash in a line's prose, in order. Empty
 * for a line whose only dashes sit in code, a comment, or an empty table cell.
 * Pure.
 */
export function proseEmDashColumns(line: string): number[] {
  const prose = toProse(line)
  const out: number[] = []
  for (let i = 0, { length } = prose.text; i < length; i += 1) {
    if (prose.text[i] === EM_DASH) {
      out.push(prose.columns[i]!)
    }
  }
  return out
}

/**
 * One entry per em-dash in `content`'s prose, with 1-based line and column.
 * Honors both escape hatches and skips fenced blocks. Pure over its input.
 */
export function scanEmDashes(content: string): EmDashFinding[] {
  if (content.includes(EM_DASH_ALLOW_FILE)) {
    return []
  }
  const out: EmDashFinding[] = []
  const lines = content.split('\n')
  let inFence = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || raw.includes(EM_DASH_ALLOW_LINE)) {
      continue
    }
    const columns = proseEmDashColumns(raw)
    for (let j = 0, { length: clen } = columns; j < clen; j += 1) {
      out.push({ column: columns[j]! + 1, line: i + 1, text: raw })
    }
  }
  return out
}

/**
 * A printable slice of `text` around 1-based `column`, plus the caret row that
 * points at it. A long line is windowed so the caret stays on screen. Pure.
 */
export function windowLine(
  text: string,
  column: number,
): { caret: string; text: string } {
  const at = column - 1
  if (text.length <= WINDOW_WIDTH) {
    return { caret: `${' '.repeat(at)}^`, text }
  }
  const start = Math.max(
    0,
    Math.min(at - WINDOW_WIDTH / 2, text.length - WINDOW_WIDTH),
  )
  const end = Math.min(text.length, start + WINDOW_WIDTH)
  const head = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  return {
    caret: `${' '.repeat(at - start + head.length)}^`,
    text: `${head}${text.slice(start, end)}${tail}`,
  }
}

/**
 * The report block for one finding: the location, the offending line, a caret
 * under the dash, and the fix. Pure.
 */
export function renderFinding(
  relPath: string,
  finding: EmDashFinding,
): string[] {
  const window = windowLine(finding.text, finding.column)
  return [
    `  ✗ ${relPath}:${finding.line}:${finding.column}`,
    `      ${window.text}`,
    `      ${window.caret}`,
    `      Fix: ${EM_DASH_FIX}.`,
  ]
}

/**
 * The line with every PROSE em-dash swapped for a plain hyphen, spacing
 * untouched. A dash in code, a comment, or an empty table cell is left exactly
 * as written. Pure.
 */
export function fixLine(line: string): string {
  const columns = proseEmDashColumns(line)
  if (!columns.length) {
    return line
  }
  const chars = [...line]
  for (let i = 0, { length } = columns; i < length; i += 1) {
    chars[columns[i]!] = '-'
  }
  return chars.join('')
}

/**
 * `content` with every prose em-dash swapped for a hyphen, plus the number of
 * lines changed. Skips fenced blocks and allow-marked lines, same as the
 * scanner, so `--fix` clears exactly what the gate flags. Pure.
 */
export function fixEmDashes(content: string): {
  changed: number
  content: string
} {
  const lines = content.split('\n')
  let inFence = false
  let changed = 0
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || raw.includes(EM_DASH_ALLOW_LINE)) {
      continue
    }
    const fixed = fixLine(raw)
    if (fixed !== raw) {
      lines[i] = fixed
      changed += 1
    }
  }
  return { changed, content: changed ? lines.join('\n') : content }
}
