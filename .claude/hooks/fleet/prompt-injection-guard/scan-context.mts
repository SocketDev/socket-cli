/*
 * @file Position classifiers for the prompt-injection-guard's shape detectors.
 *
 *   A shape detector that reads a whole line asks "does this text CONTAIN the
 *   shape", when the rule it enforces means "is this text OF that kind". The two
 *   diverge on ordinary prose: `(6+)` in a markdown table cell is a
 *   parenthesized group followed by a quantifier, and so is the ReDoS shape
 *   `(a+)+` — the difference is that one of them is a regular expression and the
 *   other is a version note about pnpm 6.
 *
 *   So the ReDoS detector runs against PATTERN POSITIONS only: the body of a
 *   `/…/flags` literal, the argument text of `RegExp(…)` or a regex method call,
 *   the value of a `pattern`/`regex` config key, and — in a code file, where a
 *   quoted string is plausibly a pattern source — a string literal that is
 *   itself regex-shaped. Markdown prose, a table cell, a `>=1.2 <2` range, a
 *   glob, and a semver caret produce no positions at all.
 *
 *   A position says WHERE to look. Its caller decides WHAT text it looks at:
 *   both a markdown file and a code file hand these functions a line whose
 *   prose has had its markdown emphasis delimiters stripped, because formatting
 *   is regex metacharacters too. `markdown-scan.mts` and `code-scan.mts` carry
 *   that reasoning.
 *
 *   The megaline detectors get the same treatment from the other end: a build
 *   output, a minified bundle, a source map, and a lockfile hold long unbroken
 *   lines because a generator emitted them that way, so their length is that
 *   generator's business rather than a hand-authored context bomb.
 */

import { isGeneratedPath } from '../../../../scripts/fleet/constants/generated-globs.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export interface PatternPositionOptions {
  // True → the file is code (`.mts`, `.tsx`, …), where a quoted string is
  // plausibly a regex source handed to `RegExp` on another line. A prose file
  // (`.md`) is prose by default and gets no string-literal positions.
  codeFile?: boolean | undefined
}

// A `/body/flags` regex literal. The leader class keeps `a/b` and a path like
// `docs/agents.md/fleet/x.md` from opening a literal — a literal never starts
// straight after a word character — and `(?![*/])` skips `//` line comments and
// `/*` block comments. The body allows `(`, `+`, and `*` — that IS the shape
// being looked for — but never an unescaped `/`, and a bracket class is stepped
// over whole so `[/]` doesn't close the literal early.
const REGEX_LITERAL_RE =
  /(?:^|[\s!%&(*+,:;<=>?[^{|~])\/(?![*/])((?:\\.|\[(?:\\.|[^\n\\\]])*\]|[^\n\\/[])+)\/[dgimsuvy]*/g

// The leader set above, on its own, for a reader that walks a line character by
// character instead of matching it whole. `code-scan.mts` carves regex literals
// out of a code file's comment prose and must agree with `REGEX_LITERAL_RE` on
// where one begins; a unit test pins the two together over the ASCII range.
const REGEX_LITERAL_LEADER_RE = /[\s!%&(*+,:;<=>?[^{|~]/

// A regex constructor or a string-taking regex API, across the fleet's
// languages: `RegExp(…)`, `Regex::new(…)` in Rust, `regexp.MustCompile(…)` in
// Go, `re.compile(…)` in Python, `Pattern.compile(…)` in Java,
// `preg_match(…)` in PHP. Only a JS/TS file gets the regex-shaped-string-literal
// position below, so for every other language this is the position that carries
// a hand-authored pattern. The match ends on the opening paren so the caller can
// slice the balanced argument text.
const REGEX_CALL_RE =
  /(?:\.(?:MustCompile|compile|exec|match|matchAll|replace|replaceAll|search|split|test)|\bRegExp|\bRegex::new|\bRegexp|\bpreg_(?:match|match_all|replace|split))\s*\(/g

// A config key whose value is a pattern: `"pattern": "…"`, `regex: …`.
const REGEX_CONFIG_KEY_RE =
  /['"]?\b(?:pattern|regex|regexp)['"]?\s*[:=]\s*(.+)$/i

// A short string literal that opens and closes on the line.
const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\n\\]){0,400})\1/g

// A string literal whose CONTENT reads as regex source: anchored at either end,
// or carrying a group modifier or a regex escape class. `'^(a+)+$'` qualifies;
// `'**(6+)**'` does not.
const REGEX_SOURCE_SHAPE_RE = /^\^|\$$|\(\?[!:<=]|\\[DSWbdsw]/

// Generated / encoded artifact FILE KINDS whose long lines are inherent, beyond
// the generated/vendored TREES that `isGeneratedPath` owns: a source map, a
// minified bundle, and the package-manager lockfiles.
const ENCODED_ARTIFACT_FILE_RE =
  /(?:^|\/)(?:Cargo\.lock|bun\.lock|go\.sum|package-lock\.json|pnpm-lock\.yaml|uv\.lock|yarn\.lock)$|\.map$|\.min\.(?:[cm]?[jt]sx?|css)$/

// Longest argument-text window scanned for one call — a pattern long enough to
// hide a nested quantifier past this is already a finding of its own kind.
const MAX_ARG_SCAN = 400

/**
 * True when a `/` preceded by `before` opens a regex literal rather than
 * dividing or sitting inside a path. `before` is the single character to the
 * left, empty at line start.
 */
export function isRegexLiteralLeader(before: string): boolean {
  return before === '' || REGEX_LITERAL_LEADER_RE.test(before)
}

/**
 * True when `text` reads as regex SOURCE rather than as a sentence: anchored at
 * either end, or carrying a group modifier or a regex escape class. `'^(a+)+$'`
 * qualifies; `'**(6+)**'` does not.
 */
export function isRegexSourceShaped(text: string): boolean {
  return REGEX_SOURCE_SHAPE_RE.test(text)
}

/**
 * The text between `line`'s paren at `openParenIndex` and its matching close
 * paren, quote-aware so a `)` inside a string doesn't close the call early.
 * Falls back to the rest of the scan window when the call runs past
 * end-of-line.
 */
export function sliceCallArgumentText(
  line: string,
  openParenIndex: number,
): string {
  const end = Math.min(line.length, openParenIndex + MAX_ARG_SCAN)
  let depth = 0
  let quote = ''
  for (let i = openParenIndex; i < end; i += 1) {
    const ch = line[i]!
    if (quote) {
      if (ch === '\\') {
        i += 1
      } else if (ch === quote) {
        quote = ''
      }
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        return line.slice(openParenIndex + 1, i)
      }
    }
  }
  return line.slice(openParenIndex + 1, end)
}

/**
 * Every slice of `line` that plausibly IS pattern text. Empty for ordinary
 * prose, which is what keeps a quantifier in a markdown table cell out of the
 * ReDoS detector's reach.
 */
export function findRegexPatternCandidates(
  line: string,
  options?: PatternPositionOptions | undefined,
): string[] {
  const opts = { __proto__: null, ...options } as PatternPositionOptions
  const out: string[] = []
  for (const m of line.matchAll(REGEX_LITERAL_RE)) {
    out.push(m[1]!)
  }
  for (const m of line.matchAll(REGEX_CALL_RE)) {
    out.push(sliceCallArgumentText(line, m.index + m[0].length - 1))
  }
  const configValue = REGEX_CONFIG_KEY_RE.exec(line)
  if (configValue) {
    out.push(configValue[1]!)
  }
  if (opts.codeFile === true) {
    for (const m of line.matchAll(STRING_LITERAL_RE)) {
      const body = m[2]!
      if (isRegexSourceShaped(body)) {
        out.push(body)
      }
    }
  }
  return out
}

/**
 * True when `filePath` is a generated, vendored, or encoded artifact — a tree
 * or file kind whose long unbroken lines come from a generator, not from an
 * author hand-writing a context bomb.
 */
export function isEncodedArtifactPath(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return (
    ENCODED_ARTIFACT_FILE_RE.test(normalized) || isGeneratedPath(normalized)
  )
}
