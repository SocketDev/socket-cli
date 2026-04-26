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

// Drops any line that matches an allowlist entry.
export const filterAllowedApiKeys = (lines: readonly string[]): string[] => {
  return lines.filter(
    line =>
      !line.includes(ALLOWED_PUBLIC_KEY) &&
      !line.includes(FAKE_TOKEN_MARKER) &&
      !line.includes(FAKE_TOKEN_LEGACY) &&
      !line.includes(SOCKET_SECURITY_ENV) &&
      !line.includes('.example'),
  )
}

// ── Personal-path scanner ──────────────────────────────────────────

// Real personal paths to flag: /Users/foo/, /home/foo/, C:\Users\foo\.
const PERSONAL_PATH_RE =
  /(\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|C:\\Users\\[^\\]+\\)/

// Placeholders we ALLOW (documentation, not real leaks): any path
// component wrapped in <...> or starting with $VAR / ${VAR}.
const PERSONAL_PATH_PLACEHOLDER_RE =
  /(\/Users\/<[^>]*>\/|\/home\/<[^>]*>\/|C:\\Users\\<[^>]*>\\|\/Users\/\$\{?[A-Z_]+\}?\/|\/home\/\$\{?[A-Z_]+\}?\/)/

export type LineHit = { lineNumber: number; line: string }

// Returns lines that contain a real personal path (excludes lines
// that are pure placeholders). Caller decides what to do with hits.
export const scanPersonalPaths = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!PERSONAL_PATH_RE.test(line)) {
      continue
    }
    if (PERSONAL_PATH_PLACEHOLDER_RE.test(line)) {
      // Has placeholder — but might also have a real path on the
      // same line. Strip placeholder forms and re-test.
      const stripped = line.replace(
        new RegExp(PERSONAL_PATH_PLACEHOLDER_RE, 'g'),
        '',
      )
      if (!PERSONAL_PATH_RE.test(stripped)) {
        continue
      }
    }
    hits.push({ lineNumber: i + 1, line })
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
    if (SOCKET_API_KEY_RE.test(line)) {
      hits.push({ lineNumber: i + 1, line })
    }
  }
  return filterAllowedApiKeys(hits.map(h => h.line)).map(line => ({
    lineNumber: hits.find(h => h.line === line)!.lineNumber,
    line,
  }))
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

export const scanNpxDlx = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (NPX_DLX_RE.test(line) && !line.includes('# zizmor:')) {
      hits.push({ lineNumber: i + 1, line })
    }
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
