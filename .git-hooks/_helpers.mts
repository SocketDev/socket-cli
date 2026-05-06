// Shared helpers for git hooks — API-key allowlist + ANSI colors +
// content scanners. Imported by .git-hooks/{commit-msg,pre-commit,
// pre-push}.mts. No third-party deps; uses only Node built-ins.
//
// Requires Node 25+ for stable .mts type-stripping (no flag needed).
// Earlier Node versions either lacked --experimental-strip-types or
// shipped it under a flag, both unacceptable for hook ergonomics.

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

// Name of the env var used in shell examples; not a token value.
export const SOCKET_SECURITY_ENV = 'SOCKET_SECURITY_API_KEY='

// ── ANSI colors ────────────────────────────────────────────────────

export const RED = '\x1b[0;31m'
export const GREEN = '\x1b[0;32m'
export const YELLOW = '\x1b[1;33m'
export const NC = '\x1b[0m'

// ── Output helpers ─────────────────────────────────────────────────

export const out = (msg: string): void => {
  process.stdout.write(msg + '\n')
}

export const err = (msg: string): void => {
  process.stderr.write(msg + '\n')
}

export const red = (msg: string): string => `${RED}${msg}${NC}`
export const green = (msg: string): string => `${GREEN}${msg}${NC}`
export const yellow = (msg: string): string => `${YELLOW}${msg}${NC}`

// ── API-key allowlist filter ───────────────────────────────────────

// Returns true if a line is on the allowlist (a public/example/fake
// token we deliberately ship). Used by scanners to drop allowlisted
// hits without losing each hit's original lineNumber.
const isAllowedApiKey = (line: string): boolean =>
  line.includes(ALLOWED_PUBLIC_KEY) ||
  line.includes(FAKE_TOKEN_MARKER) ||
  line.includes(FAKE_TOKEN_LEGACY) ||
  line.includes(SOCKET_SECURITY_ENV) ||
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

// Placeholders we ALLOW (documentation, not real leaks): any path
// component wrapped in <...> or starting with $VAR / ${VAR}.
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
// exempt; lines carrying `# socket-hook: allow logger` are exempt too.

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
