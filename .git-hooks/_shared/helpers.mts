// Shared helpers for git hooks — API-key allowlist + content scanners
// + tiny string utilities (color wrappers, marker-syntax picker, path
// normalize). Each hook imports `getDefaultLogger` from
// `@socketsecurity/lib-stable/logger/default` directly for output; this module stays
// import-light so the cost of `import '../_shared/helpers.mts'` is bounded.
//
// Requires Node 25+ for stable .mts type-stripping (no flag needed).
// Earlier Node versions either lacked --experimental-strip-types or
// shipped it under a flag, both unacceptable for hook ergonomics.
//
// Hooks run *after* `pnpm install`, so `@socketsecurity/lib-stable` is on the
// resolution path for any caller that imports it.

import { existsSync, readFileSync, statSync } from 'node:fs'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// Hard-fail if Node is below 25. This runs at module load — every
// hook invocation imports _shared/helpers.mts before doing anything, so the
// version check is the first thing that happens.
const NODE_MIN_MAJOR = 25
const nodeMajor = Number.parseInt(
  process.versions.node.split('.')[0] || '0',
  10,
)
if (nodeMajor < NODE_MIN_MAJOR) {
  // @socketsecurity/lib-stable requires Node >= 25; the canonical logger
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
// Hooks call `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default`
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

// ── API-key allowlist filter ───────────────────────────────────────

// Returns true if a line is on the allowlist (a public/example/fake
// token we deliberately ship). Used by scanners to drop allowlisted
// hits without losing each hit's original lineNumber.
//
// Previous version allowlisted any line containing the bare substring
// '.example' — too broad. Real keys on lines that mention `.example`
// anywhere (TLD, paths, prose like "see .example below") were silently
// allowlisted. Now we require either an explicit per-line marker or
// the canonical fixture filename pattern `.env.example`.
const SOCKET_API_KEY_ALLOW_MARKER = 'socket-lint: allow socket-api-key'
const isAllowedApiKey = (line: string): boolean =>
  line.includes(ALLOWED_PUBLIC_KEY) ||
  line.includes(FAKE_TOKEN_MARKER) ||
  line.includes(FAKE_TOKEN_LEGACY) ||
  SOCKET_TOKEN_ENV_NAMES.some(name => line.includes(name)) ||
  line.includes(SOCKET_API_KEY_ALLOW_MARKER) ||
  line.includes('.env.example')

// Drops any line that matches an allowlist entry. Kept for callers
// that work on bare lines; new code should filter LineHit[] directly
// via isAllowedApiKey to preserve per-hit lineNumber.
export const filterAllowedApiKeys = (lines: readonly string[]): string[] =>
  lines.filter(line => !isAllowedApiKey(line))

// ── Personal-path scanner ──────────────────────────────────────────

// Real personal paths to flag: /Users/foo/, /home/foo/, C:\Users\foo\.
// The scanner's job is to catch a hardcoded USERNAME leak. `~/...` and
// `$HOME/...` are the OPPOSITE — they're the recommended username-free
// forms (and the placeholder-allowlist below explicitly accepts them),
// so they MUST NOT be flagged. (An earlier revision added `~/` /
// `$HOME/` here, which wrongly flagged canonical fixed paths like
// `~/.config/gh/hosts.yml` and `~/.claude/...` and blocked the push.)
// NFKC normalization is applied at the scanLines layer before this
// regex runs so full-width / Unicode variants of `/Users` (e.g.
// `／Users／foo／`) don't slip past.
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
  /(?:#|\/\/|\/\*)\s*socket-lint:\s*allow(?:\s+([\w-]+))?/

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
function scanLines(
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
      looksLikeDocumentation(lineForMatch, pattern, options.skipDocs.rule)
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
    // NFKC-normalize before match — catches full-width and ligature
    // variants that would otherwise slip past the ASCII-only regex.
    normalizeForMatch: true,
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
// GitHub token formats — accepts both classic opaque and new JWT
// formats per the 2026-05-15 token-format rollout:
//
//   - ghp_ / gho_ / ghr_ / ghu_ / ghs_  : classic opaque 36+ chars
//   - ghs_ + ghu_ (NEW)                  : JWT format, ~520 chars,
//                                          contains two dots and
//                                          underscores. ghu_ scheduled
//                                          for same rollout per
//                                          changelog (timing TBD).
//   - github_pat_                        : fine-grained PAT
//
// The `[A-Za-z0-9._]` char class on ghs_/ghu_ covers BOTH formats
// (classic: alnum only; JWT: alnum + `.` + `_`). Minimum length 36
// is the floor for both formats — classic tokens are 36+ chars after
// the prefix, JWTs are ~520. GitHub's recommended regex is
// `ghs_[A-Za-z0-9\._]{36,}`.
const GITHUB_TOKEN_RE =
  /\b(?:ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|ghr_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9._]{36,}|ghu_[A-Za-z0-9._]{36,}|github_pat_[A-Za-z0-9_]{20,})/
// Private-key PEM headers. Covers every type that wraps a private
// key in PEM armor:
//   - `BEGIN PRIVATE KEY` (PKCS#8, generic)
//   - `BEGIN RSA PRIVATE KEY` (PKCS#1, OpenSSL classic)
//   - `BEGIN EC PRIVATE KEY` / `BEGIN DSA PRIVATE KEY`
//   - `BEGIN OPENSSH PRIVATE KEY` (default ssh-keygen output since 2019;
//     the most common case for personal SSH keys)
//   - `BEGIN ENCRYPTED PRIVATE KEY` (PKCS#8 passphrase-protected)
//   - `BEGIN PGP PRIVATE KEY BLOCK` (PGP secret keys)
// The leading `[A-Z ]*` accepts any uppercase-letters+space prefix
// before "PRIVATE KEY" so future formats are caught automatically.
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----/

export const scanSocketApiKeys = (text: string): LineHit[] =>
  scanLines(text, SOCKET_API_KEY_RE, { filter: isAllowedApiKey })

export const scanAwsKeys = (text: string): LineHit[] =>
  scanLines(text, AWS_KEY_RE)

export const scanGitHubTokens = (text: string): LineHit[] =>
  scanLines(text, GITHUB_TOKEN_RE)

export const scanPrivateKeys = (text: string): LineHit[] =>
  scanLines(text, PRIVATE_KEY_RE)

// ── package.json pnpm.overrides scanner ────────────────────────────
//
// Dependency overrides belong in pnpm-workspace.yaml `overrides:`, the
// fleet's single override surface. A non-empty `pnpm.overrides` block in
// a package.json splits the source of truth and sits outside the
// workspace file's `trustPolicy: no-downgrade`. Structural, not
// line-pattern: parse the JSON, flag a non-empty `pnpm.overrides`. Points
// the hit at the `"overrides"` line so the message is actionable. Returns
// no hits on parse failure (fail open; oxfmt / other gates catch broken
// JSON).
export const scanPackageJsonPnpmOverrides = (text: string): LineHit[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const pnpm = (parsed as { pnpm?: unknown } | null)?.pnpm
  const overrides =
    pnpm && typeof pnpm === 'object'
      ? (pnpm as { overrides?: unknown }).overrides
      : undefined
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Object.keys(overrides as Record<string, unknown>).length === 0
  ) {
    return []
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (/"overrides"\s*:/.test(lines[i]!)) {
      return [{ lineNumber: i + 1, line: lines[i]!.trim() }]
    }
  }
  return [{ lineNumber: 1, line: '"pnpm": { "overrides": { … } }' }]
}

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

// ── pnpm-first docs scanner ────────────────────────────────────────
//
// Fleet rule: user-facing documentation that shows install commands
// should LEAD with the pnpm form (`pnpm install <pkg>`, `pnpm add
// <pkg>`). npm / yarn fallbacks are fine, but they should appear
// after the pnpm form — or in a sibling code block introduced as a
// fallback for users who don't have pnpm.
//
// This scanner walks fenced markdown code blocks (``` or ~~~) and
// emits a warning for any fence whose first install-shape line is
// npm/yarn rather than pnpm. Warning-only — never fails a commit.
// Inline backtick spans (a single `npm install foo` in prose) are
// NOT scanned; only block-level fences.
//
// Suppression: a line containing `socket-lint: allow pnpm-first`
// anywhere in the fence (or just above it) skips that block.

// Match shell install commands at line start (allowing leading
// whitespace + `$` prompt). Captures the package manager so the
// caller can tell which form was seen first.
const PNPM_INSTALL_LINE_RE = /^\s*\$?\s*pnpm\s+(?:add|i|install)\b/
const NPM_YARN_INSTALL_LINE_RE =
  /^\s*\$?\s*(?:(npm)\s+(?:add|i|install)|(?:yarn)\s+(?:install|add)|(?:yarn))\s/

// Markdown fence opener: ``` or ~~~ at line start, optionally followed
// by an info string (language hint). We don't require closing match —
// just count fences as we go and treat alternating opens/closes.
const FENCE_OPEN_RE = /^\s*(?:```|~~~)/

const PNPM_FIRST_SUPPRESS_RE = /socket-lint:\s*allow\s+pnpm-first\b/

export const scanDocsPnpmFirst = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  let inFence = false
  let fenceStartLine = -1
  let fenceHasPnpm = false
  let fenceHasSuppress = false
  let fenceFirstNpmYarnHit: LineHit | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_OPEN_RE.test(line)) {
      // Closing fence: flush any pending hit if no pnpm form was seen
      // and the block wasn't suppressed.
      if (inFence) {
        if (fenceFirstNpmYarnHit && !fenceHasPnpm && !fenceHasSuppress) {
          hits.push(fenceFirstNpmYarnHit)
        }
        inFence = false
        fenceStartLine = -1
        fenceHasPnpm = false
        fenceHasSuppress = false
        fenceFirstNpmYarnHit = undefined
      } else {
        inFence = true
        fenceStartLine = i + 1
      }
      continue
    }
    if (!inFence) {
      // Suppression marker on a comment line just above the fence is
      // also honored (some docs prefer keeping markers outside the
      // rendered code block).
      if (PNPM_FIRST_SUPPRESS_RE.test(line)) {
        // Look ahead one line for a fence open; if it's there, mark
        // the upcoming block as suppressed.
        const next = lines[i + 1]
        if (next !== undefined && FENCE_OPEN_RE.test(next)) {
          fenceHasSuppress = true
        }
      }
      continue
    }
    if (PNPM_FIRST_SUPPRESS_RE.test(line)) {
      fenceHasSuppress = true
      continue
    }
    if (PNPM_INSTALL_LINE_RE.test(line)) {
      fenceHasPnpm = true
      continue
    }
    if (
      NPM_YARN_INSTALL_LINE_RE.test(line) &&
      fenceFirstNpmYarnHit === undefined
    ) {
      fenceFirstNpmYarnHit = {
        lineNumber: i + 1,
        line,
        suggested: line.replace(/\b(npm|yarn)\s+(add|i|install)\b/, 'pnpm $2'),
      }
    }
  }
  // Unclosed fence at EOF — flush whatever's pending.
  if (inFence && fenceFirstNpmYarnHit && !fenceHasPnpm && !fenceHasSuppress) {
    hits.push(fenceFirstNpmYarnHit)
  }
  // Reference fenceStartLine to suppress unused-variable lints; the
  // value is useful for future enhancements (e.g. block-level
  // diagnostics) but the current per-line LineHit shape carries the
  // offending line number directly.
  void fenceStartLine
  return hits
}

// ── Logger leak scanner ────────────────────────────────────────────
//
// The fleet rule: source code uses `getDefaultLogger()` from
// `@socketsecurity/lib-stable/logger/default`. Two distinct leak shapes,
// each with its OWN per-line opt-out marker so a reviewer can tell which
// exemption was granted:
//
//   - `console.{log,error,warn,info,debug}` → rule `console`, marker
//     `// socket-lint: allow console`. Legacy `allow logger` is accepted
//     as an alias for one deprecation cycle.
//   - `process.std{out,err}.write` → rule `process-stdio`, marker
//     `// socket-lint: allow process-stdio`. Reserved for the rare CLI
//     whose stdio IS a protocol (a runner whose stdout a caller parses
//     back), where a logger prefix would corrupt the bytes.
//
// Doc-context lines are exempt from both. `scanLoggerLeaks` merges the
// two passes so callers (pre-commit / pre-push) keep one entry point.

const CONSOLE_LEAK_RE = /\bconsole\.(?:debug|error|info|log|warn)\s*\(/
const PROCESS_STDIO_LEAK_RE = /\bprocess\.std(?:err|out)\.write\s*\(/

// Map each direct call to its lib-logger equivalent. process.stdout /
// console.log / console.info → logger.info; process.stderr /
// console.error → logger.error; console.warn → logger.warn;
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

export const scanConsoleLeaks = (text: string): LineHit[] =>
  scanLines(text, CONSOLE_LEAK_RE, {
    skipDocs: { rule: 'console' },
    suggest: suggestLoggerReplacement,
  })

export const scanProcessStdioLeaks = (text: string): LineHit[] =>
  scanLines(text, PROCESS_STDIO_LEAK_RE, {
    skipDocs: { rule: 'process-stdio' },
    suggest: suggestLoggerReplacement,
  })

// Merged entry point: both leak shapes, in line order, deduped by line
// number so a single line carrying both forms is reported once.
export function scanLoggerLeaks(text: string): LineHit[] {
  const hits = [...scanConsoleLeaks(text), ...scanProcessStdioLeaks(text)]
  const byLine = new Map<number, LineHit>()
  for (const hit of hits) {
    if (!byLine.has(hit.lineNumber)) {
      byLine.set(hit.lineNumber, hit)
    }
  }
  return [...byLine.values()].sort((a, b) => a.lineNumber - b.lineNumber)
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
// (`@socketsecurity/lib-stable/...`, `@socketsecurity/registry-stable/...`).
// Scanner detects both shapes; suppress with the canonical marker
// `<comment-prefix> socket-lint: allow cross-repo`.

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
  'socket-vscode',
  'socket-webext',
  'ultrathink',
] as const

// `../<repo>/…` or `../../<repo>/…` etc. — relative path that walks
// out of the current repo into a sibling fleet repo. The trailing `/`
// (not `\b`) requires the repo name to name a DIRECTORY: `\b` treats
// `-` as a boundary, so it false-matched a sibling FILE whose basename
// merely starts with a repo name (e.g. a `<repo>-config` import in the
// same dir). A real cross-repo path always has a separator after the name.
const CROSS_REPO_RELATIVE_RE = new RegExp(
  String.raw`(?:^|[\s'"\`(=,])\.\.(?:/\.\.)*/(?:${FLEET_REPO_NAMES.join('|')})/`,
)
// `…/projects/<repo>/…` — absolute or env-rooted path into a sibling
// fleet repo. Catches cases where scanPersonalPaths has already been
// satisfied via `${HOME}` / `<user>` substitution but the path itself
// still escapes into another repo.
const CROSS_REPO_ABSOLUTE_RE = new RegExp(
  String.raw`/projects/(?:${FLEET_REPO_NAMES.join('|')})/`,
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
  /(?:(?:Authored|Built|Crafted|Created|Generated|Made|Powered|Written)\s+(?:with|by)\s+(?:Claude|AI|GPT|ChatGPT|Copilot|Cursor|Bard|Gemini)|Co-Authored-By:\s+(?:Claude|AI|GPT|ChatGPT|Copilot|Cursor|Bard|Gemini)|🤖\s+Generated|AI[\s-]generated|Machine[\s-]generated|@(?:anthropic|openai)\.com|^Assistant:)/im

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
  /\.(spec|test)\.(m?[jt]s|tsx?|cts|mts)$|\.example$|\/test\/|\/tests\/|fixtures\/|\.git-hooks\/|node_modules\/|pnpm-lock\.yaml/

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
//                      by design — _shared/helpers.mts can't import the canonical
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

// Staged-path prefixes/suffixes that mean an oxlint-plugin rule's WIRING could
// have changed: a rule file added/removed, the plugin index, or the oxlintrc
// activations. Both the dogfood root copies and the `template/` mirrors count.
const OXLINT_WIRING_PATH_RE =
  /(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/rules\/[^/]+\.mts$|(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/index\.mts$|(?:^|\/)(?:template\/)?\.config\/oxlintrc\.json$|(?:^|\/)(?:template\/)?\.config\/oxlint-plugin\/test\/[^/]+\.test\.mts$/

// Path (relative to repo root) of the rule-wiring generator. Present only in
// the wheelhouse — downstream fleet repos don't carry it, so the gate no-ops
// there (they have no plugin rule files to wire).
const SYNC_OXLINT_RULES_REL = 'scripts/fleet/sync-oxlint-rules.mts'

/**
 * Commit-time gate for oxlint plugin rule WIRING. When a commit stages any file
 * that can change rule wiring (a `rules/*.mts`, the plugin `index.mts`, the
 * `oxlintrc.json` activations, or a rule `test`), run the generator in
 * `--check` mode so a half-wired rule (file present but not imported /
 * activated / tested) can't land — even on a direct commit with no PR.
 *
 * Returns the generator's diagnostic text when wiring is out of sync, or
 * `undefined` when everything is in sync, no relevant file is staged, or the
 * generator isn't present (downstream repo). Deliberately fail-closed only on a
 * real drift signal: a generator that can't run (missing deps pre-install,
 * spawn error) returns undefined so a fresh checkout isn't blocked.
 *
 * @param stagedFiles POSIX-normalized staged paths (from `git diff --cached`).
 * @param repoRoot Absolute repo toplevel.
 */
export const checkOxlintRuleWiringStaged = (
  stagedFiles: readonly string[],
  repoRoot: string,
): string | undefined => {
  const touchesWiring = stagedFiles.some(f => OXLINT_WIRING_PATH_RE.test(f))
  if (!touchesWiring) {
    return undefined
  }
  const generatorPath = `${repoRoot}/${SYNC_OXLINT_RULES_REL}`
  if (!existsSync(generatorPath)) {
    return undefined
  }
  const r = spawnSync(process.execPath, [generatorPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  // Spawn failure (missing deps, node error) — fail open so a pre-install
  // checkout isn't blocked. Only a clean non-zero EXIT is a drift signal.
  if (r.error || typeof r.status !== 'number') {
    return undefined
  }
  if (r.status === 0) {
    return undefined
  }
  return (
    (r.stderr ?? '').trim() ||
    (r.stdout ?? '').trim() ||
    'sync-oxlint-rules --check reported drift.'
  )
}

// ── Staged-test reminder (WARN, never blocks) ──────────────────────
//
// `scripts/fleet/test.mts --staged` runs `vitest related` on the staged delta.
// Nothing invoked it at commit time, so a commit could break its own tests and
// the breakage only surfaced at pre-push / CI. This runs it as a NON-BLOCKING
// reminder: a failure prints a warning so the author sees it at the earliest
// moment, but the commit still lands. That's deliberate — the fleet cadence
// (CLAUDE.md "Smallest chunks, land ASAP") explicitly allows per-step
// `--no-verify` commits and gates tests at the MERGE (`fix --all` / `check
// --all` / `test` before landing). A blocking pre-commit test run would fight
// that workflow and slow every commit; the reminder surfaces breakage without
// changing the cadence. Returns a warning string on test failure, undefined on
// pass / no-related-tests / spawn error (fail-open).

const TEST_RUNNER_REL = 'scripts/fleet/test.mts'

// A staged file that could change test outcomes: a TS/JS source or test file.
// Lockfiles, markdown, JSON config, assets don't map to `vitest related`.
const TESTABLE_FILE_RE = /\.(?:c|m)?[jt]sx?$/

export const runStagedTestsReminder = (
  stagedFiles: readonly string[],
  repoRoot: string,
): string | undefined => {
  const anyTestable = stagedFiles.some(f => TESTABLE_FILE_RE.test(f))
  if (!anyTestable) {
    return undefined
  }
  const runnerPath = `${repoRoot}/${TEST_RUNNER_REL}`
  if (!existsSync(runnerPath)) {
    return undefined
  }
  const r = spawnSync(process.execPath, [runnerPath, '--staged', '--quiet'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  // Fail open: a spawn error (missing deps on a fresh checkout, node crash) is
  // not a test failure. Only a clean non-zero exit means staged tests failed.
  if (r.error || typeof r.status !== 'number' || r.status === 0) {
    return undefined
  }
  return (
    (r.stdout ?? '').trim() ||
    (r.stderr ?? '').trim() ||
    'vitest related reported failing tests for the staged delta.'
  )
}

// ── Programmatic-Claude lockdown (HARD block) ──────────────────────
//
// A `.mts` that drives Claude programmatically (the agent SDK `query({…})`
// or `new ClaudeSDKClient({…})`) MUST pin the four lockdown options; a headless
// agent without them can be steered into arbitrary tool use. The
// claude-lockdown-guard hook covers the `claude` CLI at Bash time; this covers
// the SDK call sites in committed source (round-2 code-is-law gap: no
// commit/push tier existed for the non-Bash form). Deterministic, so it blocks.
//
// Flags a line that opens a `query(` / `new ClaudeSDKClient(` call when the
// surrounding file does NOT also mention all four option keys, OR when it sets a
// forbidden permission mode. Conservative: only fires when a driver call is
// actually present, and reads the whole file for the keys (they're often on
// separate lines), so a call with the options nearby passes.
const CLAUDE_DRIVER_RE = /\b(?:query|new\s+ClaudeSDKClient)\s*\(/
const LOCKDOWN_KEYS = [
  'tools',
  'allowedTools',
  'disallowedTools',
  'permissionMode',
] as const
const BAD_PERMISSION_MODE_RE =
  /permissionMode\s*:\s*['"`](?:bypassPermissions|default)['"`]/
const BYPASS_PERMISSIONS_RE = /\bbypassPermissions\b/

export const scanProgrammaticClaudeLockdown = (text: string): LineHit[] => {
  if (!CLAUDE_DRIVER_RE.test(text)) {
    return []
  }
  // A forbidden mode anywhere is an immediate fail, pointed at its line.
  const badMode = scanLines(text, BAD_PERMISSION_MODE_RE)
  if (badMode.length > 0) {
    return badMode
  }
  // bypassPermissions in any form (string/flag) is forbidden.
  const bypass = scanLines(text, BYPASS_PERMISSIONS_RE)
  if (bypass.length > 0) {
    return bypass
  }
  // All four keys must appear somewhere in the file. If any is missing, flag
  // the driver-call line(s).
  const missing = LOCKDOWN_KEYS.filter(
    k => !new RegExp(`\\b${k}\\s*:`).test(text),
  )
  if (missing.length === 0) {
    return []
  }
  return scanLines(text, CLAUDE_DRIVER_RE)
}

// ── Soak-exclude date annotations (HARD block, pnpm-workspace.yaml) ──
//
// Every exact-pin soak-bypass entry (`'pkg@1.2.3'`) under
// `minimumReleaseAgeExclude:` MUST carry a `# published: YYYY-MM-DD | removable:
// YYYY-MM-DD` annotation on the line above. The edit-time guard + the
// soak-excludes-have-dates check cover Claude-authored edits + CI; this is the
// push-time tier for entries that landed via non-Claude paths. Deterministic.
const SOAK_BLOCK_RE = /^\s*minimumReleaseAgeExclude:\s*$/
const SOAK_PIN_RE = /^\s*-\s*['"]?[^'"#\s]+@[^'"#\s]+['"]?\s*$/
const SOAK_ANNOTATION_RE =
  /^\s*#\s+published:\s+\d{4}-\d{2}-\d{2}\s+\|\s+removable:\s+\d{4}-\d{2}-\d{2}\s*$/
// Same opt-out the canonical soak-excludes-have-dates check honors — an entry
// that legitimately can't carry a date annotation marks the slot above it.
const SOAK_ALLOW_MARKER = '# socket-lint: allow soak-exclude-no-date-annotation'

export const scanSoakExcludeDateAnnotations = (text: string): LineHit[] => {
  const lines = text.split('\n')
  const hits: LineHit[] = []
  let inBlock = false
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (SOAK_BLOCK_RE.test(line)) {
      inBlock = true
      continue
    }
    // Block ends at the next non-indented, non-blank line.
    if (inBlock && line !== '' && !/^\s/.test(line)) {
      inBlock = false
    }
    if (!inBlock) {
      continue
    }
    // An exact-pin bullet (`- 'pkg@1.2.3'`) needs the annotation directly above
    // — unless the slot above carries the allow-marker (parity with the
    // canonical soak-excludes-have-dates check).
    if (SOAK_PIN_RE.test(line)) {
      const prev = i > 0 ? lines[i - 1]! : ''
      if (!SOAK_ANNOTATION_RE.test(prev) && !prev.includes(SOAK_ALLOW_MARKER)) {
        hits.push({ lineNumber: i + 1, line })
      }
    }
  }
  return hits
}

// ── AI-config poison fingerprints (WARN — heuristic, never blocks) ──
//
// Out-of-band writes to `.claude/`/`.cursor/`/`.gemini/`/`.vscode/` that tell an
// agent to bypass a guard, exfiltrate secrets, or store tokens off-keychain are
// the npm-worm postinstall signature. The edit-time ai-config-poisoning-guard
// sees only Claude's OWN writes; a poison file that arrives via a dependency /
// merge / outside editor reaches push unscanned. Heuristic + literal-pattern, so
// it WARNS (surfaces for a human glance) rather than blocking — a false block on
// a mandatory push gate is worse than a missed nudge.
const POISON_RES: readonly RegExp[] = [
  // An `Allow <x> bypass` phrase planted in a config file (not a hook/doc).
  /\bAllow\s+[a-z][a-z0-9-]*\s+bypass\b/i,
  // Exfiltration: curl/fetch/POST a SOCKET_API* / GITHUB_TOKEN somewhere.
  /(?:curl|fetch|https?:\/\/)[^\n]*(?:SOCKET_API|GITHUB_TOKEN|GH_TOKEN)/i,
  // Store a token off-keychain (into a dotenv / dotfile).
  /(?:SOCKET_API\w*|GITHUB_TOKEN)\s*=.*(?:>>?\s*[~.]|\.env|\.zshrc|\.bashrc)/i,
  // Tell the agent to disable / ignore a guard.
  /(?:disable|ignore|skip|turn off)\s+(?:the\s+)?[a-z-]*(?:guard|hook|check)\b/i,
]

export const scanAiConfigPoison = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (let p = 0, { length: pLen } = POISON_RES; p < pLen; p += 1) {
      if (POISON_RES[p]!.test(line)) {
        hits.push({ lineNumber: i + 1, line })
        break
      }
    }
  }
  return hits
}
