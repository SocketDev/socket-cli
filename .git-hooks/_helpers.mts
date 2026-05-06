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
  process.stderr.write(
    `\x1b[0;31m✗ Hook requires Node >= ${NODE_MIN_MAJOR}.0.0 (have v${process.versions.node})\x1b[0m\n`,
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
// socket-lib/test/unit/utils/fake-tokens.ts). Lines containing this
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

function lineIsSuppressed(line: string, rule?: string): boolean {
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
  // Marker named a specific rule → only suppress that rule.
  return rule === undefined || m[1] === rule
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

function isInsideBackticks(line: string, needleRe: RegExp): boolean {
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

function looksLikeDocumentation(
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

// Build a suggested rewrite for a documentation-style personal path.
// Replaces the matched real-path username segment with the canonical
// placeholder form: `<user>` / `<USERNAME>` (matching the platform
// convention of the surrounding path).
function suggestPlaceholder(line: string): string {
  return line
    .replace(/\/Users\/[^/\s]+\//g, '/Users/<user>/')
    .replace(/\/home\/[^/\s]+\//g, '/home/<user>/')
    .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\<USERNAME>\\')
}

// Returns lines that contain a real personal path (excludes lines that
// are pure placeholders or look like documentation examples). Each hit
// carries a `suggested` rewrite when the scanner can offer one — the
// caller surfaces it to the user as the fix recipe.
export const scanPersonalPaths = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!PERSONAL_PATH_RE.test(line)) {
      continue
    }
    if (PERSONAL_PATH_PLACEHOLDER_RE.test(line)) {
      const stripped = line.replace(
        new RegExp(PERSONAL_PATH_PLACEHOLDER_RE, 'g'),
        '',
      )
      if (!PERSONAL_PATH_RE.test(stripped)) {
        continue
      }
    }
    if (looksLikeDocumentation(line, PERSONAL_PATH_RE, 'personal-path')) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: suggestPlaceholder(line),
    })
  }
  return hits
}

// ── Secret scanners ────────────────────────────────────────────────

const SOCKET_API_KEY_RE = /sktsec_[a-zA-Z0-9_-]+/
const AWS_KEY_RE = /(aws_access_key|aws_secret|\bAKIA[0-9A-Z]{16}\b)/i
const GITHUB_TOKEN_RE = /gh[ps]_[a-zA-Z0-9]{36}/
const PRIVATE_KEY_RE = /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/

export const scanSocketApiKeys = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (SOCKET_API_KEY_RE.test(line) && !isAllowedApiKey(line)) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return hits
}

export const scanAwsKeys = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (AWS_KEY_RE.test(line)) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return hits
}

export const scanGitHubTokens = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (GITHUB_TOKEN_RE.test(line)) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return hits
}

export const scanPrivateKeys = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (PRIVATE_KEY_RE.test(line)) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return hits
}

// ── npx/dlx scanner ────────────────────────────────────────────────

const NPX_DLX_RE = /\b(npx|pnpm dlx|yarn dlx)\b/

// Suggest the canonical replacement for a runtime npx/dlx call.
// Documentation contexts (comments, JSDoc) are exempt via
// looksLikeDocumentation(); we only ever land here for code lines, where
// the right swap is `pnpm exec` (since `pnpm` is the fleet's package
// manager) or `pnpm run` for script entries.
function suggestNpxReplacement(line: string): string {
  return line
    .replace(/\bpnpm dlx\b/g, 'pnpm exec')
    .replace(/\byarn dlx\b/g, 'pnpm exec')
    .replace(/\bnpx\b/g, 'pnpm exec')
}

export const scanNpxDlx = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!NPX_DLX_RE.test(line)) {
      continue
    }
    if (looksLikeDocumentation(line, NPX_DLX_RE, 'npx')) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: suggestNpxReplacement(line),
    })
  }
  return hits
}

// ── Logger leak scanner ────────────────────────────────────────────
//
// The fleet rule: source code uses `getDefaultLogger()` from
// `@socketsecurity/lib/logger`. Direct calls to `process.stderr.write`,
// `process.stdout.write`, `console.log`, `console.error`, `console.warn`,
// `console.info`, `console.debug` are blocked. Doc-context lines are
// exempt; lines carrying `// socket-hook: allow logger` (or `#` in
// non-TS files) are exempt too.

const LOGGER_LEAK_RE =
  /\b(process\.std(?:err|out)\.write|console\.(?:log|error|warn|info|debug))\s*\(/

// Map each direct call to its lib-logger equivalent. process.stdout is
// closer to logger.info; process.stderr / console.error → logger.error;
// console.warn → logger.warn; console.info / console.log → logger.info;
// console.debug → logger.debug.
function suggestLoggerReplacement(line: string): string {
  return line
    .replace(/\bprocess\.stderr\.write\s*\(/g, 'logger.error(')
    .replace(/\bprocess\.stdout\.write\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.error\s*\(/g, 'logger.error(')
    .replace(/\bconsole\.warn\s*\(/g, 'logger.warn(')
    .replace(/\bconsole\.info\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.debug\s*\(/g, 'logger.debug(')
    .replace(/\bconsole\.log\s*\(/g, 'logger.info(')
}

export const scanLoggerLeaks = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!LOGGER_LEAK_RE.test(line)) {
      continue
    }
    if (looksLikeDocumentation(line, LOGGER_LEAK_RE, 'logger')) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: suggestLoggerReplacement(line),
    })
  }
  return hits
}

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
  'socket-addon',
  'socket-btm',
  'socket-cli',
  'socket-lib',
  'socket-packageurl-js',
  'socket-registry',
  'socket-repo-template',
  'socket-sdk-js',
  'socket-sdxgen',
  'socket-stuie',
  'ultrathink',
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
  const lines = text.split('\n')
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

const AI_ATTRIBUTION_RE =
  /(Generated with.*(Claude|AI)|Co-Authored-By: Claude|Co-Authored-By: AI|🤖 Generated|AI generated|@anthropic\.com|Assistant:|Generated by Claude|Machine generated|Claude Code)/i

export const containsAiAttribution = (text: string): boolean =>
  AI_ATTRIBUTION_RE.test(text)

export const stripAiAttribution = (
  text: string,
): { cleaned: string; removed: number } => {
  const lines = text.split('\n')
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
  for (const rawLine of text.split('\n')) {
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

// Files we never scan: hooks themselves, husky shims, test fixtures.
const SKIP_FILE_RE =
  /\.(test|spec)\.(m?[jt]s|tsx?|cts|mts)$|\.example$|\/test\/|\/tests\/|fixtures\/|\.git-hooks\/|\.husky\/|node_modules\/|pnpm-lock\.yaml/

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

export const git = (...args: string[]): string => {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  return result.stdout.trim()
}

export const gitLines = (...args: string[]): string[] => {
  const out = git(...args)
  return out ? out.split('\n') : []
}
