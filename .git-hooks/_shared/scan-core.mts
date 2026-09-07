// Scanning kernel shared by every git-hook content scanner: line-splitting,
// the per-line opt-out marker + documentation-context detection, and the
// generic `scanLines` line-walk factory the concrete scanners are built on.
// Gate-free (no Node-25 hard-exit like helpers.mts) — pure string logic with
// no external side effects.

// Collapse a template archetype-layer path back to its flat repo-relative form:
// `template/base/.git-hooks/x` → `template/.git-hooks/x`, same for `solo/` /
// `mono/` / `overrides/<repo>/`. The archetype move (template/* →
// template/{base,solo,mono,overrides/<repo>}/*) inserts a layer segment that
// every `startsWith('template/.claude/hooks/')`-style exemption would otherwise
// miss, re-flagging code that's intentionally raw where it actually runs. One
// strip here lets all the prefix exemptions stay layer-agnostic (and keeps the
// pre-move flat `template/` path matching for downstream repos not yet moved).
import {
  ruleNameForMarker,
  suppressionWaivesNextLine,
  suppressionWaivesOwnLine,
} from '../../.claude/hooks/fleet/_shared/suppression-rules.mts'

export const stripTemplateLayer = (p: string): string =>
  p
    .replace(/^template\/(?:base|mono|solo)\//, 'template/')
    .replace(/^template\/overrides\/[^/]+\//, 'template/')

/**
 * Split text into lines, normalizing CRLF (`\r\n`) to LF (`\n`) first.
 *
 * Hooks consume text from three sources where CRLF can show up:
 *
 * - Subprocess stdout/stderr (especially git on Windows / msys)
 * - Stdin from the `git push` protocol on Windows
 * - File contents from a working copy with `core.autocrlf` semantics
 *
 * Plain `text.split('\n')` on CRLF input leaves a trailing `\r` on every line,
 * which breaks per-line regex anchors used by the secret / personal-path /
 * AI-attribution scanners. The hook then reports "no findings" on Windows even
 * though the input clearly contains them — a security-gate fail-open. Always go
 * through this helper for any text that didn't originate as a literal in our
 * own code.
 */
export const splitLines = (text: string): string[] =>
  text.replace(/\r\n/g, '\n').split(/\r?\n/)

// Per-line opt-out marker for our pre-commit / pre-push scanners.
//
// Canonical form:    <comment-prefix> oxlint-disable-next-line
// Targeted form:     <comment-prefix> oxlint-disable-next-line <rule>
//
// `<comment-prefix>` is whichever comment style the host file uses —
// `#` for shell / YAML / TOML / Dockerfile, `//` for TS / JS / Rust /
// Go / C-family, or `/*` for the C-block-comment opener. The hook is
// invoked from many file types; pinning to `#` made the marker fail
// silently in `.ts` / `.mts` files (where `// oxlint-disable-next-line` is
// the only sensible spelling) and confused contributors.
//
// The targeted form names a specific rule (`personal-path`, `npx`,
// `aws-key`, etc.) and is recommended for reviewers; the bare `allow`
// form blanket-suppresses every scanner on that line. eslint-style
// precedent.
//
// Legacy `# zizmor: ...` markers are still recognized for one cycle so
// existing files don't have to be rewritten in the same change that
// renames the marker.

// The oxlint-shaped spelling of the same opt-out, so one comment form works
// whichever enforcer owns the rule. oxlint disables a PLUGIN rule natively
// (`oxlint-disable-line socket/<rule>`), but these scanners are not oxlint
// rules — they read shell, YAML, and Markdown that oxlint never parses — so
// nothing native can cover them. Rather than keep a second vocabulary for the
// difference, the scanners accept oxlint's grammar and key off the rule name
// the way every other linter does.
//
// oxlint's two directives map onto the two positions this file already has:
// `-line` suppresses the line it sits on, `-next-line` the one below. Matching
// that split exactly means a reader never has to remember which enforcer a
// rule belongs to. `suppressionWaives` owns the grammar for both, so this file
// carries no pattern of its own.

/**
 * The rule id an opt-out on `line` names, in either spelling. `matched` is
 * false when the line carries no opt-out at all; `id` is undefined for the
 * bare `oxlint-disable-next-line` blanket form, which names no rule. Pure.
 */
const LEGACY_ZIZMOR_MARKER_RE = /(?:#|\/\*|\/\/)\s*zizmor:\s*[\w-]+/

// File extensions whose natural comment syntax is `//` (C-family + cousins).
// Anything else falls through to `#` (shell / YAML / TOML / Dockerfile /
// Makefile / Python / Ruby / etc).
const SLASH_COMMENT_EXT_RE =
  /\.(m?ts|tsx|cts|m?js|jsx|cjs|rs|go|c|cc|cpp|cxx|h|hpp|java|swift|kt|scala|dart|php|css|scss|less)$/i

/**
 * The suppression a contributor should paste into `filePath` to waive `rule`.
 *
 * Prints the ONE comment form that file's lexer takes — `//` for the C-family,
 * `#` for shell / YAML / TOML — so the fix an error message offers is copyable
 * rather than a grammar the reader has to adapt.
 *
 * `rule` may be a scanner's historical opt-out name; the table resolves it to
 * the rule the directive now spells, so a scanner keeps its own vocabulary and
 * still emits something the linter honors.
 */
export const suppressionFor = (filePath: string, rule: string): string => {
  const named = ruleNameForMarker(rule) ?? `socket/${rule}`
  const directive = `oxlint-disable-next-line ${named} -- <reason>`
  return SLASH_COMMENT_EXT_RE.test(filePath)
    ? `// ${directive}`
    : `# ${directive}`
}

export function lineIsSuppressed(
  line: string,
  rule?: string | undefined,
): boolean {
  if (LEGACY_ZIZMOR_MARKER_RE.test(line)) {
    return true
  }
  // The linter's own directive is the fleet's ONE suppression syntax. A caller
  // with no rule in hand cannot be answered — there is no blanket form to fall
  // back on, which is the point: a waiver names what it waives. Same-line means
  // `-disable-line`; a trailing `-next-line` points at the line below.
  return rule !== undefined && suppressionWaivesOwnLine(line, rule)
}

export function suppressionCoversLine(
  lines: readonly string[],
  index: number,
  rule?: string | undefined,
): boolean {
  if (lineIsSuppressed(lines[index] ?? '', rule)) {
    return true
  }
  if (index <= 0) {
    return false
  }
  // `-disable-next-line` on the line above covers this one.
  return (
    rule !== undefined &&
    suppressionWaivesNextLine(lines[index - 1] ?? '', rule)
  )
}

// Heuristic context flags: lines that look like "this is a doc example"
// rather than a real call leaked into runtime code.
//   - Comment lines (start with `*`, `//`, `#`).
//   - Lines that contain a JSDoc tag like @example / @param / @returns
//     (multi-line JSDoc bodies use leading ` * ` which we already match).
//   - Lines whose entire interesting content sits inside a backtick span
//     (markdown / template-literal example).
const COMMENT_LINE_RE = /^\s*(#|\*|\/\/)/
// Matches a JSDoc tag (@example, @param, @returns/@return, @see, @link) at a word boundary.
const JSDOC_TAG_RE = /@(example|link|param|returns?|see)\b/

export function isInsideBackticks(line: string, needleRe: RegExp): boolean {
  // Find every backtick-delimited span on the line and test if the
  // pattern only appears within those spans. Conservative: if any
  // hit is *outside* a span, treat the line as runtime code.
  const spans: Array<[number, number]> = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '`') {
      const end = line.indexOf('`', i + 1)
      if (end < 0) {
        break
      }
      spans.push([i, end])
      i = end
    }
  }
  if (spans.length === 0) {
    return false
  }
  let m: RegExpExecArray | null
  const re = new RegExp(needleRe.source, needleRe.flags.replace('g', '') + 'g')
  while ((m = re.exec(line)) !== null) {
    const start = m.index
    const end = start + m[0].length
    const inside = spans.some(([s, e]) => start > s && end <= e)
    if (!inside) {
      return false
    }
  }
  return true
}

export function looksLikeDocumentation(
  line: string,
  needleRe: RegExp,
  rule?: string | undefined,
): boolean {
  if (lineIsSuppressed(line, rule)) {
    return true
  }
  if (COMMENT_LINE_RE.test(line)) {
    return true
  }
  if (JSDOC_TAG_RE.test(line)) {
    return true
  }
  if (isInsideBackticks(line, needleRe)) {
    return true
  }
  return false
}

/**
 * The index of every line that sits inside a `/* … *\/` block comment.
 *
 * COMMENT_LINE_RE only recognizes a line whose FIRST token is a comment
 * marker, so it sees the opening `/*` line and nothing after it. A block
 * comment written without a leading `*` on each continuation - the shape
 * `c8 ignore` blocks and long rationales use - therefore reads as code, and
 * prose naming a banned command gets flagged as an invocation of it. Tracking
 * the open/close state answers that for the whole block instead of asking each
 * line to prove it is a comment.
 *
 * Line-scoped, matching the rest of this scanner: a `/*` inside a string or a
 * regex literal would open a block that is not really open. That is the same
 * bet every heuristic here makes, and it fails toward silence (a skipped line)
 * rather than toward a false accusation.
 */
export function blockCommentLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>()
  let open = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (open) {
      inside.add(i)
      if (line.includes('*/')) {
        open = false
      }
      continue
    }
    const start = line.indexOf('/*')
    if (start !== -1 && !line.includes('*/', start)) {
      inside.add(i)
      open = true
    }
  }
  return inside
}

export type LineHit = {
  lineNumber: number
  line: string
  // Suggested rewrite when this flagged line is documentation-style and
  // the scanner can offer a concrete fix. Undefined for runtime-code
  // paths where the right answer depends on the surrounding code.
  suggested?: string | undefined
}

// Generic line-walk scanner factory. Splits text into lines once,
// applies the regex per line, optionally skips lines via `filter` (for
// allowlists) and/or via `skipDocs` (for documentation-style
// detection), and optionally attaches a suggested rewrite. Centralizes
// the loop shape that every concrete scanner used to inline.
//
// Options:
//   filter — return true to drop a line (e.g. allowlist match).
//   skipDocs.rule — when set, calls looksLikeDocumentation() with the
//     same regex + this rule name and skips lines that match.
//   suggest — produces the per-line `suggested` rewrite shown to users.
export function scanLines(
  text: string,
  pattern: RegExp,
  options: {
    filter?: ((line: string) => boolean) | undefined
    skipDocs?: { rule: string } | undefined
    suggest?: ((line: string) => string) | undefined
    // NFKC-normalize each line before regex match. Catches Unicode
    // variants of leak markers (full-width slashes, etc.). Off by
    // default — secret-token regexes match exact ASCII byte
    // sequences and must NOT be Unicode-normalized.
    normalizeForMatch?: boolean | undefined
  } = {},
): LineHit[] {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  // Computed once per scan, only for the scanners that skip documentation.
  const insideBlockComment = options.skipDocs
    ? blockCommentLines(lines)
    : undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lineForMatch = options.normalizeForMatch
      ? line.normalize('NFKC')
      : line
    if (!pattern.test(lineForMatch)) {
      continue
    }
    if (options.filter && options.filter(lineForMatch)) {
      continue
    }
    if (
      options.skipDocs &&
      (insideBlockComment?.has(i) ||
        looksLikeDocumentation(lineForMatch, pattern, options.skipDocs.rule) ||
        suppressionCoversLine(lines, i, options.skipDocs.rule))
    ) {
      continue
    }
    const hit: LineHit = { lineNumber: i + 1, line }
    if (options.suggest) {
      hit.suggested = options.suggest(line)
    }
    hits.push(hit)
  }
  return hits
}
