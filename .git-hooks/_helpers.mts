// Shared helpers for git hooks — API-key allowlist + content scanners
// + tiny string utilities (color wrappers, marker-syntax picker, path
// normalize). Each hook imports `getDefaultLogger` from
// `@socketsecurity/lib/logger` directly for output; this module stays
// import-light so the cost of `import './_helpers.mts'` is bounded.
//
// Requires Node 25+ for stable .mts type-stripping (no flag needed).
// Earlier Node versions either lacked --experimental-strip-types or
// shipped it under a flag, both unacceptable for hook ergonomics.
//
// Hooks run *after* `pnpm install`, so `@socketsecurity/lib` is on the
// resolution path for any caller that imports it.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'

// Hard-fail if Node is below 25. This runs at module load — every
// hook invocation imports _helpers.mts before doing anything, so the
// version check is the first thing that happens.
const NODE_MIN_MAJOR = 25
const nodeMajor = Number.parseInt(
  process.versions.node.split('.')[0] || '0',
  10,
)
if (nodeMajor < NODE_MIN_MAJOR) {
  // @socketsecurity/lib requires Node >= 25; the canonical logger
  // isn't importable here. Use raw process.stderr with ASCII (no
  // status-emoji glyph) so the no-status-emoji lint rule stays clean
  // — the lint rule's recommendation (use logger.fail()) doesn't
  // apply when the entire branch is the logger-unavailable bail.
  process.stderr.write(
    `\x1b[0;31mHook requires Node >= ${NODE_MIN_MAJOR}.0.0 (have v${process.versions.node})\x1b[0m\n`,
  )
  process.stderr.write(
    'Install Node 25+ — these hooks rely on stable .mts type stripping.\n',
  )
  process.exit(1)
}

// ── Allowlist constants ────────────────────────────────────────────
// These exempt known-safe matches from the API-key scanner. Each
// allowlist entry is a substring; if the matched line contains it,
// the line is dropped from the findings.

// Real public API key shipped in socket-lib test fixtures. Safe to
// appear anywhere in the fleet.
export const ALLOWED_PUBLIC_KEY =
  'sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api'

// Substring marker used in test fixtures (see
// socket-lib/test/unit/util/fake-tokens.ts). Lines containing this
// are treated as test fixtures.
export const FAKE_TOKEN_MARKER = 'socket-test-fake-token'

// Legacy lib-scoped marker — accepted during the rename from
// `socket-lib-test-fake-token` to `socket-test-fake-token`. Drop when
// lib's rename PR lands.
export const FAKE_TOKEN_LEGACY = 'socket-lib-test-fake-token'

// Env-var name prefixes used in shell examples / `.env.example` files.
// Lines containing `<name>=` are documentation, not real tokens — drop
// them from secret-scanner hits. SOCKET_API_TOKEN is the canonical
// fleet name; the rest are legacy variants kept on the allowlist for
// one cycle so existing `.env.example` files don't trip the gate
// after the rebrand.
export const SOCKET_TOKEN_ENV_NAMES: readonly string[] = [
  'SOCKET_API_TOKEN=',
  'SOCKET_API_KEY=',
  'SOCKET_SECURITY_API_TOKEN=',
  'SOCKET_SECURITY_API_KEY=',
]
// Back-compat alias — earlier callers imported this single-string
// constant. New code should reach for SOCKET_TOKEN_ENV_NAMES.
export const SOCKET_SECURITY_ENV = SOCKET_TOKEN_ENV_NAMES[0]!

// ── Output ──────────────────────────────────────────────────────────
//
// Hooks call `getDefaultLogger()` from `@socketsecurity/lib/logger`
// directly. Color comes from the logger's semantic methods —
// `.fail()` is red ✖, `.success()` is green ✔, `.warn()` is yellow ⚠,
// `.info()` is blue ℹ, `.error()` is plain. ANSI constants and
// `red()`/`green()`/`yellow()` wrappers are intentionally NOT exported
// from this module; the logger owns the visual surface.

// Posix-form path normalization for staged file lists. Git on Windows
// can hand back backslash separators in some surfaces; the downstream
// `startsWith('.git-hooks/')` / `includes('/external/')` pattern
// matching assumes forward slashes. Cheap to convert once.
export const normalizePath = (p: string): string => p.replace(/\\/g, '/')

/**
 * Split text into lines, normalizing CRLF (`\r\n`) to LF (`\n`) first.
 *
 * Hooks consume text from three sources where CRLF can show up:
 *   - subprocess stdout/stderr (especially git on Windows / msys)
 *   - stdin from the git push protocol on Windows
 *   - file contents from a working copy with `core.autocrlf` semantics
 *
 * Plain `text.split('\n')` on CRLF input leaves a trailing `\r` on every
 * line, which breaks per-line regex anchors used by the secret /
 * personal-path / AI-attribution scanners. The hook then reports "no
 * findings" on Windows even though the input clearly contains them —
 * a security-gate fail-open. Always go through this helper for any
 * text that didn't originate as a literal in our own code.
 */
export const splitLines = (text: string): string[] =>
  text.replace(/\r\n/g, '\n').split('\n')

// ── API-key allowlist filter ───────────────────────────────────────

// Returns true if a line is on the allowlist (a public/example/fake
// token we deliberately ship). Used by scanners to drop allowlisted
// hits without losing each hit's original lineNumber.
const isAllowedApiKey = (line: string): boolean =>
  line.includes(ALLOWED_PUBLIC_KEY) ||
  line.includes(FAKE_TOKEN_MARKER) ||
  line.includes(FAKE_TOKEN_LEGACY) ||
  SOCKET_TOKEN_ENV_NAMES.some(name => line.includes(name)) ||
  line.includes('.example')

// Drops any line that matches an allowlist entry. Kept for callers
// that work on bare lines; new code should filter LineHit[] directly
// via isAllowedApiKey to preserve per-hit lineNumber.
export const filterAllowedApiKeys = (lines: readonly string[]): string[] =>
  lines.filter(line => !isAllowedApiKey(line))

// ── Personal-path scanner ──────────────────────────────────────────

// Real personal paths to flag: /Users/foo/, /home/foo/, C:\Users\foo\.
const PERSONAL_PATH_RE =
  /(\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|C:\\Users\\[^\\]+\\)/

// Placeholders we ALLOW (documentation, not real leaks). The scanner
// accepts any path component wrapped in <...> or starting with $VAR /
// ${VAR}, but for **canonical fleet style** use exactly these forms in
// docs / tests / comments / error messages — pick the one matching the
// path's platform:
//
//   POSIX  →  /Users/<user>/...     (macOS — `<user>` matches $USER)
//   POSIX  →  /home/<user>/...      (Linux — same convention)
//   Windows →  C:\Users\<USERNAME>\... (matches %USERNAME%)
//
// Don't drift to `<name>` / `<me>` / `<USER>` / `<u>` etc. The
// `suggestPersonalPathReplacement` helper below auto-rewrites real
// paths into these canonical shapes; mirror its output everywhere
// else.
const PERSONAL_PATH_PLACEHOLDER_RE =
  /(\/Users\/<[^>]*>\/|\/home\/<[^>]*>\/|C:\\Users\\<[^>]*>\\|\/Users\/\$\{?[A-Z_]+\}?\/|\/home\/\$\{?[A-Z_]+\}?\/)/

// Per-line opt-out marker for our pre-commit / pre-push scanners.
//
// Canonical form:    <comment-prefix> socket-hook: allow
// Targeted form:     <comment-prefix> socket-hook: allow <rule>
//
// `<comment-prefix>` is whichever comment style the host file uses —
// `#` for shell / YAML / TOML / Dockerfile, `//` for TS / JS / Rust /
// Go / C-family, or `/*` for the C-block-comment opener. The hook is
// invoked from many file types; pinning to `#` made the marker fail
// silently in `.ts` / `.mts` files (where `// socket-hook: allow` is
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
const SOCKET_HOOK_MARKER_RE =
  /(?:#|\/\/|\/\*)\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

// File extensions whose natural comment syntax is `//` (C-family + cousins).
// Anything else falls through to `#` (shell / YAML / TOML / Dockerfile /
// Makefile / Python / Ruby / etc).
const SLASH_COMMENT_EXT_RE =
  /\.(m?ts|tsx|cts|m?js|jsx|cjs|rs|go|c|cc|cpp|cxx|h|hpp|java|swift|kt|scala|dart|php|css|scss|less)$/i

/**
 * Pick the natural per-line opt-out marker for a host file.
 *
 * The marker regex above accepts `#`, `//`, and `/*` prefixes — but error
 * messages should print the *one* form a contributor would actually paste
 * into that file. TS edits get `// socket-hook: allow <rule>`; YAML gets
 * `# socket-hook: allow <rule>`. Same rule, different comment lexer.
 */
export const socketHookMarkerFor = (filePath: string, rule: string): string =>
  SLASH_COMMENT_EXT_RE.test(filePath)
    ? `// socket-hook: allow ${rule}`
    : `# socket-hook: allow ${rule}`
const LEGACY_ZIZMOR_MARKER_RE = /(?:#|\/\/|\/\*)\s*zizmor:\s*[\w-]+/

// Aliases: legacy marker names recognized as equivalent to a current
// rule for one deprecation cycle, so callers can rename the canonical
// rule without breaking files that still carry the old marker.
//
// Add entries as `<alias>: <canonical>`; both directions match in the
// comparison below.
const RULE_ALIASES: { [k: string]: string | undefined } = {
  __proto__: null,
  // 'logger' was the original name when the scanner only flagged
  // process.std{out,err}.write; it now flags console.* too, so the
  // canonical marker is 'console'. Keep 'logger' for one cycle.
  logger: 'console',
}

export function aliasMatches(marker: string, rule: string): boolean {
  if (marker === rule) {
    return true
  }
  return RULE_ALIASES[marker] === rule || RULE_ALIASES[rule] === marker
}

export function lineIsSuppressed(line: string, rule?: string): boolean {
  if (LEGACY_ZIZMOR_MARKER_RE.test(line)) {
    return true
  }
  const m = line.match(SOCKET_HOOK_MARKER_RE)
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

// Heuristic context flags: lines that look like "this is a doc example"
// rather than a real call leaked into runtime code.
//   - Comment lines (start with `*`, `//`, `#`).
//   - Lines that contain a JSDoc tag like @example / @param / @returns
//     (multi-line JSDoc bodies use leading ` * ` which we already match).
//   - Lines whose entire interesting content sits inside a backtick span
//     (markdown / template-literal example).
const COMMENT_LINE_RE = /^\s*(\*|\/\/|#)/
const JSDOC_TAG_RE = /@(example|param|returns?|see|link)\b/

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
  rule?: string,
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
  suggested?: string
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
function scanLines(
  text: string,
  pattern: RegExp,
  options: {
    filter?: (line: string) => boolean
    skipDocs?: { rule: string }
    suggest?: (line: string) => string
  } = {},
): LineHit[] {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!pattern.test(line)) {
      continue
    }
    if (options.filter && options.filter(line)) {
      continue
    }
    if (
      options.skipDocs &&
      looksLikeDocumentation(line, pattern, options.skipDocs.rule)
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

// Build a suggested rewrite for a documentation-style personal path.
// Replaces the matched real-path username segment with the canonical
// placeholder form: `<user>` / `<USERNAME>` (matching the platform
// convention of the surrounding path).
export function suggestPlaceholder(line: string): string {
  return line
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<user>/')
    .replace(/\/home\/[^/\s]+\//g, '/home/<user>/')
    .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\<USERNAME>\\')
}

// Returns lines that contain a real personal path (excludes lines that
// are pure placeholders or look like documentation examples). Each hit
// carries a `suggested` rewrite when the scanner can offer one — the
// caller surfaces it to the user as the fix recipe.
export const scanPersonalPaths = (text: string): LineHit[] =>
  scanLines(text, PERSONAL_PATH_RE, {
    filter: line => {
      // Pure-placeholder lines (no real path remains after stripping
      // every `<...>` placeholder) are documentation, not leaks.
      if (!PERSONAL_PATH_PLACEHOLDER_RE.test(line)) {
        return false
      }
      const stripped = line.replace(
        new RegExp(PERSONAL_PATH_PLACEHOLDER_RE, 'g'),
        '',
      )
      return !PERSONAL_PATH_RE.test(stripped)
    },
    skipDocs: { rule: 'personal-path' },
    suggest: suggestPlaceholder,
  })

// ── Secret scanners ────────────────────────────────────────────────

const SOCKET_API_KEY_RE = /sktsec_[a-zA-Z0-9_-]+/
const AWS_KEY_RE = /(aws_access_key|aws_secret|\bAKIA[0-9A-Z]{16}\b)/i
const GITHUB_TOKEN_RE = /gh[ps]_[a-zA-Z0-9]{36}/
const PRIVATE_KEY_RE = /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/

export const scanSocketApiKeys = (text: string): LineHit[] =>
  scanLines(text, SOCKET_API_KEY_RE, { filter: isAllowedApiKey })

export const scanAwsKeys = (text: string): LineHit[] =>
  scanLines(text, AWS_KEY_RE)

export const scanGitHubTokens = (text: string): LineHit[] =>
  scanLines(text, GITHUB_TOKEN_RE)

export const scanPrivateKeys = (text: string): LineHit[] =>
  scanLines(text, PRIVATE_KEY_RE)

// ── npx/dlx scanner ────────────────────────────────────────────────
//
// Match `npx` / `yarn dlx` only when the token sits at a command
// position — preceded by start-of-line / whitespace / shell separator
// (`&&`, `||`, `;`, `|`, `(`, backtick), or directly after a PowerShell
// `& ` invoke. Exclude JSON-key, env-value, and identifier suffix
// contexts where `npx` shows up as an embedded substring:
//   - `"socket-npx": …`            (bin-name suffix)
//   - `"dev:npx": "…SOCKET_CLI_MODE=npx node …"` (script key + env value)
//   - `cmd-npx-helper`             (identifier interior)
// The negative lookbehind catches hyphen / colon / equals / underscore /
// dot prefixes; the negative lookahead catches the same followed forms
// (`npx-helper`, `npx:foo`).
//
// **Allowed:** `pnpm dlx` / `pnpm exec` / `pn dlx` / `pn exec` / `pnx`
// (the pnpm v11 shorthands for `pnpm dlx`). `pnpm dlx` is the
// fleet-canonical fetch-and-run form for documentation lines that
// describe ad-hoc CLI usage (where the consumer doesn't have the
// package pinned in their workspace). `pnx` is the v11 shorthand and
// is equally allowed.

const NPX_DLX_RE = /(?<![\w\-:=.])\b(npx|yarn dlx)\b(?![\w\-:=.])/

// Suggest the canonical replacement for a runtime npx/dlx call.
// Documentation contexts (comments, JSDoc) are exempt via
// looksLikeDocumentation(); we only ever land here for code lines, where
// the right swap is `pnpm exec` (since `pnpm` is the fleet's package
// manager) or `pnpm run` for script entries. For documentation lines
// All dlx-style invocations rewrite to `pnpm exec`. This matches the
// `socket/no-npx-dlx` oxlint rule's autofix and the CLAUDE.md tooling
// rule (NEVER use npx / pnpm dlx / yarn dlx — use pnpm exec). Keep
// the alternation ordered longest-prefix-first so `pnpm dlx` matches
// before any future `pnpm`-anchored rule could shadow it.
export function suggestNpxReplacement(line: string): string {
  return line
    .replace(/\bpnpm dlx\b/g, 'pnpm exec')
    .replace(/\byarn dlx\b/g, 'pnpm exec')
    .replace(/\bpnx\b/g, 'pnpm exec')
    .replace(/\bnpx\b/g, 'pnpm exec')
}

export const scanNpxDlx = (text: string): LineHit[] =>
  scanLines(text, NPX_DLX_RE, {
    skipDocs: { rule: 'npx' },
    suggest: suggestNpxReplacement,
  })

// ── Logger leak scanner ────────────────────────────────────────────
//
// The fleet rule: source code uses `getDefaultLogger()` from
// `@socketsecurity/lib/logger`. Direct calls to `process.stderr.write`,
// `process.stdout.write`, `console.log`, `console.error`, `console.warn`,
// `console.info`, `console.debug` are blocked. Doc-context lines are
// exempt; lines carrying `// socket-hook: allow console` (or `#` in
// non-TS files) are exempt too. Legacy `allow logger` is accepted as
// an alias for one deprecation cycle.

const LOGGER_LEAK_RE =
  /\b(process\.std(?:err|out)\.write|console\.(?:log|error|warn|info|debug))\s*\(/

// Map each direct call to its lib-logger equivalent. process.stdout is
// closer to logger.info; process.stderr / console.error → logger.error;
// console.warn → logger.warn; console.info / console.log → logger.info;
// console.debug → logger.debug.
export function suggestLoggerReplacement(line: string): string {
  return line
    .replace(/\bprocess\.stderr\.write\s*\(/g, 'logger.error(')
    .replace(/\bprocess\.stdout\.write\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.error\s*\(/g, 'logger.error(')
    .replace(/\bconsole\.warn\s*\(/g, 'logger.warn(')
    .replace(/\bconsole\.info\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.debug\s*\(/g, 'logger.debug(')
    .replace(/\bconsole\.log\s*\(/g, 'logger.info(')
}

export const scanLoggerLeaks = (text: string): LineHit[] =>
  scanLines(text, LOGGER_LEAK_RE, {
    skipDocs: { rule: 'console' },
    suggest: suggestLoggerReplacement,
  })

// ── Cross-repo path scanner ────────────────────────────────────────
//
// Two forbidden forms catch the same mistake — referencing another
// fleet repo by a path that escapes the current repo:
//
//   1. `../<fleet-repo>/…` (cross-repo relative). Hardcodes the
//      assumption that both repos are sibling clones under the same
//      projects root; breaks in CI sandboxes / fresh clones / non-
//      standard layouts.
//   2. `<abs-prefix>/projects/<fleet-repo>/…` (cross-repo absolute,
//      where <abs-prefix> isn't already caught by scanPersonalPaths
//      because it uses a placeholder like `${HOME}`).
//
// The right way is to import from the published npm package
// (`@socketsecurity/lib/...`, `@socketsecurity/registry/...`).
// Scanner detects both shapes; suppress with the canonical marker
// `<comment-prefix> socket-hook: allow cross-repo`.

const FLEET_REPO_NAMES = [
  'claude-code',
  'skills',
  'socket-addon',
  'socket-btm',
  'socket-cli',
  'socket-lib',
  'socket-packageurl-js',
  'socket-registry',
  'socket-wheelhouse',
  'socket-sdk-js',
  'socket-sdxgen',
  'socket-stuie',
  'ultrathink',
  'vscode-socket-security',
] as const

// `../<repo>/…` or `../../<repo>/…` etc. — relative path that walks
// out of the current repo into a sibling fleet repo.
const CROSS_REPO_RELATIVE_RE = new RegExp(
  String.raw`(?:^|[\s'"\`(=,])\.\.(?:/\.\.)*/(?:${FLEET_REPO_NAMES.join('|')})\b`,
)
// `…/projects/<repo>/…` — absolute or env-rooted path into a sibling
// fleet repo. Catches cases where scanPersonalPaths has already been
// satisfied via `${HOME}` / `<user>` substitution but the path itself
// still escapes into another repo.
const CROSS_REPO_ABSOLUTE_RE = new RegExp(
  String.raw`/projects/(?:${FLEET_REPO_NAMES.join('|')})\b`,
)
const CROSS_REPO_ANY_RE = new RegExp(
  `${CROSS_REPO_RELATIVE_RE.source}|${CROSS_REPO_ABSOLUTE_RE.source}`,
)

export const scanCrossRepoPaths = (
  text: string,
  currentRepoName?: string,
): LineHit[] => {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const m = line.match(CROSS_REPO_ANY_RE)
    if (!m) {
      continue
    }
    // A repo's own paths (`socket-lib/...` referenced from inside
    // socket-lib) are fine — we only catch cross-repo escapes.
    const matched = m[0]
    if (currentRepoName && matched.includes(`/${currentRepoName}`)) {
      continue
    }
    if (looksLikeDocumentation(line, CROSS_REPO_ANY_RE, 'cross-repo')) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: '',
    })
  }
  return hits
}

// ── AI attribution scanner ─────────────────────────────────────────
//
// Matches BOILERPLATE attribution patterns ("Generated with Claude",
// "Co-Authored-By: Claude", emoji prefixes, vendor email addresses) —
// not legitimate product / directory references. Bare "Claude" /
// "Claude Code" / ".claude/" are valid prose; only the
// attribution-verb-anchored forms trigger the hook.

const AI_ATTRIBUTION_RE =
  /(?:(?:Generated|Built|Created|Made|Written|Authored|Powered|Crafted)\s+(?:with|by)\s+(?:Claude|AI|GPT|ChatGPT|Copilot|Cursor|Bard|Gemini)|Co-Authored-By:\s+(?:Claude|AI|GPT|ChatGPT|Copilot|Cursor|Bard|Gemini)|🤖\s+Generated|AI[\s-]generated|Machine[\s-]generated|@(?:anthropic|openai)\.com|^Assistant:)/im

export const containsAiAttribution = (text: string): boolean =>
  AI_ATTRIBUTION_RE.test(text)

export const stripAiAttribution = (
  text: string,
): { cleaned: string; removed: number } => {
  const lines = splitLines(text)
  const kept: string[] = []
  let removed = 0
  for (const line of lines) {
    if (AI_ATTRIBUTION_RE.test(line)) {
      removed++
    } else {
      kept.push(line)
    }
  }
  return { cleaned: kept.join('\n'), removed }
}

// ── Linear reference scanner ──────────────────────────────────────
//
// Linear tracking lives in Linear; commit messages stay tool-agnostic
// (the same rule appears in the canonical CLAUDE.md "public-surface
// hygiene" block). This scanner enforces it on commit messages and is
// invoked by .git-hooks/commit-msg.mts.
//
// The team-key list is enumerated from the Socket Linear workspace.
// `PATCH` is listed before `PAT` so the longest-prefix wins on
// strings like `PATCH-123` — JS regex alternation is leftmost, not
// longest, so order is load-bearing.
const LINEAR_TEAM_KEYS = [
  'ASK',
  'AUTO',
  'BOT',
  'CE',
  'CORE',
  'DAT',
  'DES',
  'DEV',
  'ENG',
  'INFRA',
  'LAB',
  'MAR',
  'MET',
  'OPS',
  'PAR',
  'PATCH',
  'PAT',
  'PLAT',
  'REA',
  'SALES',
  'SBOM',
  'SEC',
  'SMO',
  'SUP',
  'TES',
  'TI',
  'WEB',
] as const

// Match either:
//   - a team-key + dash + digits, surrounded by non-word chars (or
//     line start/end) so we don't match inside identifiers like
//     `someENG-123foo`
//   - a literal `linear.app/<path>` URL fragment
//
// `(^|[^A-Za-z0-9_])` and `($|[^A-Za-z0-9_])` are word-boundary
// equivalents that also accept end-of-line, since `\b` in JS treats
// punctuation as a word boundary inconsistently.
const LINEAR_REF_RE = new RegExp(
  `(^|[^A-Za-z0-9_])(${LINEAR_TEAM_KEYS.join('|')})-[0-9]+($|[^A-Za-z0-9_])|linear\\.app/[A-Za-z0-9/_-]+`,
  'g',
)

// Capture groups for LINEAR_REF_RE:
//   - match[0]: full match including the leading/trailing word
//     boundary chars (or the linear.app URL).
//   - match[1]: leading non-word char (when the team-key branch matched).
//   - match[2]: team key (when the team-key branch matched).
// Use the team-key branch's middle chunk by re-extracting `<KEY>-<N>`
// from match[0]; the URL branch returns match[0] verbatim minus the
// surrounding word boundaries (which it doesn't have).
const LINEAR_KEY_DIGITS_RE = new RegExp(
  `(${LINEAR_TEAM_KEYS.join('|')})-[0-9]+`,
)

// Returns up to `limit` distinct Linear-style references found in
// `text`. Comment lines (lines starting with `#`, after the leading
// whitespace is stripped) are ignored — git uses those for the
// "Please enter the commit message" hint and we don't want to flag
// references that appeared in the diff snippet that git inlined.
export const scanLinearRefs = (text: string, limit = 5): string[] => {
  const hits: string[] = []
  for (const rawLine of splitLines(text)) {
    if (rawLine.trimStart().startsWith('#')) {
      continue
    }
    LINEAR_REF_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = LINEAR_REF_RE.exec(rawLine))) {
      // Extract the canonical reference: `KEY-NNN` for team-key
      // matches, or the linear.app/... fragment verbatim.
      const inner = LINEAR_KEY_DIGITS_RE.exec(match[0])
      const ref = inner ? inner[0] : match[0]
      if (!hits.includes(ref)) {
        hits.push(ref)
        if (hits.length >= limit) {
          return hits
        }
      }
    }
  }
  return hits
}

// ── File classification ────────────────────────────────────────────

// Files we never scan: hooks themselves (both the .mts files and the
// shell shims under .git-hooks/), test fixtures, vendored lockfiles.
const SKIP_FILE_RE =
  /\.(test|spec)\.(m?[jt]s|tsx?|cts|mts)$|\.example$|\/test\/|\/tests\/|fixtures\/|\.git-hooks\/|node_modules\/|pnpm-lock\.yaml/

export const shouldSkipFile = (filePath: string): boolean =>
  SKIP_FILE_RE.test(filePath)

// Returns file content as a string. For binaries, runs `strings` to
// extract printable byte sequences (catches paths embedded in WASM
// or other compiled artifacts).
export const readFileForScan = (filePath: string): string => {
  if (!existsSync(filePath)) {
    return ''
  }
  try {
    if (statSync(filePath).isDirectory()) {
      return ''
    }
  } catch {
    return ''
  }
  // Detect binary via grep -I (matches text-only); if grep says
  // binary, fall back to `strings`.
  const grepResult = spawnSync('grep', ['-qI', '', filePath])
  if (grepResult.status === 0) {
    // Text file.
    try {
      return readFileSync(filePath, 'utf8')
    } catch {
      return ''
    }
  }
  // Binary — extract strings.
  const stringsResult = spawnSync('strings', [filePath], {
    encoding: 'utf8',
  })
  return stringsResult.stdout || ''
}

// ── Git wrappers ───────────────────────────────────────────────────
//
// Two flavors:
//
//   git(...)         — loose. Returns '' on failure. Used by callers that
//                      legitimately tolerate a missing ref (e.g. probing
//                      remote default-branch HEAD which may not be set up
//                      locally) and provide their own fallback. Silent
//                      by design — _helpers.mts can't import the canonical
//                      logger because it runs before the Node-version
//                      gate has cleared, and a fire-and-forget dynamic
//                      import races process exit. Callers that need to
//                      know about failure should use gitOrThrow().
//
//   gitOrThrow(...)  — strict. Throws on either spawn error (git not on
//                      PATH, EAGAIN, …) or non-zero exit. Used by gitLines
//                      and every security-gate caller in pre-commit /
//                      pre-push: if `git diff --cached --name-only` fails
//                      we MUST refuse to greenlight the commit, not pass
//                      it with "no files to check."
//
// gitLines goes through gitOrThrow because every call site we have
// (staged-file iteration, push-range walking, repo-toplevel lookup)
// makes a security or correctness decision based on the result; an
// empty array from a failed git invocation is a fail-open.

export const git = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return (result.stdout ?? '').trim()
}

export const gitOrThrow = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.error) {
    throw new Error(`git ${args.join(' ')}: ${result.error.message}`)
  }
  if (typeof result.status !== 'number' || result.status !== 0) {
    const err = result.stderr?.trim() || `exit ${result.status}`
    throw new Error(`git ${args.join(' ')}: ${err}`)
  }
  return (result.stdout ?? '').trim()
}

export const gitLines = (...args: string[]): string[] => {
  const out = gitOrThrow(...args)
  return out ? splitLines(out) : []
}
