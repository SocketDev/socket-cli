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
 * - Stdin from the git push protocol on Windows
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
  text.replace(/\r\n/g, '\n').split('\n')

// Per-line opt-out marker for our pre-commit / pre-push scanners.
//
// Canonical form:    <comment-prefix> socket-lint: allow
// Targeted form:     <comment-prefix> socket-lint: allow <rule>
//
// `<comment-prefix>` is whichever comment style the host file uses —
// `#` for shell / YAML / TOML / Dockerfile, `//` for TS / JS / Rust /
// Go / C-family, or `/*` for the C-block-comment opener. The hook is
// invoked from many file types; pinning to `#` made the marker fail
// silently in `.ts` / `.mts` files (where `// socket-lint: allow` is
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
const SOCKET_LINT_MARKER_RE =
  /(?:#|\/\*|\/\/)\s*socket-lint:\s*allow(?:\s+([\w-]+))?/

// File extensions whose natural comment syntax is `//` (C-family + cousins).
// Anything else falls through to `#` (shell / YAML / TOML / Dockerfile /
// Makefile / Python / Ruby / etc).
const SLASH_COMMENT_EXT_RE =
  /\.(m?ts|tsx|cts|m?js|jsx|cjs|rs|go|c|cc|cpp|cxx|h|hpp|java|swift|kt|scala|dart|php|css|scss|less)$/i

/**
 * Pick the natural per-line opt-out marker for a host file.
 *
 * The marker regex above accepts `#`, `//`, and `/*` prefixes — but error
 * messages should print the _one_ form a contributor would actually paste into
 * that file. TS edits get `// socket-lint: allow <rule>`; YAML gets `#
 * socket-lint: allow <rule>`. Same rule, different comment lexer.
 */
export const socketLintMarkerFor = (filePath: string, rule: string): string =>
  SLASH_COMMENT_EXT_RE.test(filePath)
    ? `// socket-lint: allow ${rule}`
    : `# socket-lint: allow ${rule}`
const LEGACY_ZIZMOR_MARKER_RE = /(?:#|\/\*|\/\/)\s*zizmor:\s*[\w-]+/

// Aliases: legacy marker names recognized as equivalent to a current
// rule for one deprecation cycle, so callers can rename the canonical
// rule without breaking files that still carry the old marker.
//
// Add entries as `<alias>: <canonical>`; both directions match in the
// comparison below.
const RULE_ALIASES = new Map<string, string>([
  // 'logger' was the original name when the scanner only flagged
  // process.std{out,err}.write; it now flags console.* too, so the
  // canonical marker is 'console'. Keep 'logger' for one cycle.
  ['logger', 'console'],
])

export function aliasMatches(marker: string, rule: string): boolean {
  if (marker === rule) {
    return true
  }
  return RULE_ALIASES.get(marker) === rule || RULE_ALIASES.get(rule) === marker
}

export function lineIsSuppressed(
  line: string,
  rule?: string | undefined,
): boolean {
  if (LEGACY_ZIZMOR_MARKER_RE.test(line)) {
    return true
  }
  const m = line.match(SOCKET_LINT_MARKER_RE)
  if (!m) {
    return false
  }
  // No rule named on the marker → blanket allow.
  if (!m[1]) {
    return true
  }
  // Marker named a specific rule → suppress when the names match
  // directly OR through an alias.
  return rule === undefined || aliasMatches(m[1], rule)
}

// A line that is ONLY an opt-out marker comment — the marker right after the
// comment opener, optionally a `-- reason` tail, optionally a block-comment
// close. Such a line covers the LINE BELOW it, so a long pragma can sit above
// the code it excuses instead of trailing it. Mirrors
// SOCKET_LINT_MARKER_ONLY_LINE_RE in .claude/hooks/fleet/_shared/markers.mts.
const SOCKET_LINT_MARKER_ONLY_LINE_RE =
  /^\s*(?:#|\/\*|\/\/)\s*socket-lint:\s*allow(?:\s+([\w-]+))?(?:\s*\*\/|\s+--.*)?\s*$/

/**
 * True when `lines[index]` is suppressed for `rule` — by a marker on the line
 * itself, or by a marker-only comment line directly above it.
 */
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
  const m = (lines[index - 1] ?? '').match(SOCKET_LINT_MARKER_ONLY_LINE_RE)
  if (!m) {
    return false
  }
  // Bare marker or no rule context → blanket allow, same as the inline form.
  if (!m[1] || rule === undefined) {
    return true
  }
  return aliasMatches(m[1], rule)
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
      (looksLikeDocumentation(lineForMatch, pattern, options.skipDocs.rule) ||
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
