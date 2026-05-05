#!/usr/bin/env node
// Claude Code PreToolUse hook — logger-guard.
//
// Blocks Edit/Write tool calls that would introduce direct calls to
// `process.stderr.write`, `process.stdout.write`, `console.log`,
// `console.error`, `console.warn`, `console.info`, or `console.debug`
// in source files. Exit code 2 makes Claude Code refuse the tool call
// so the diff never lands. The model sees the rejection reason on
// stderr and retries using the lib's logger.
//
// Why this rule:
//
//   The fleet's source code uses `getDefaultLogger()` from
//   `@socketsecurity/lib/logger` for every output. Direct stream writes
//   bypass:
//     - Color/theme handling
//     - Indentation tracking
//     - Stream redirection in tests
//     - Counter increments used by spinners
//   so they produce inconsistent output that breaks layout-sensitive
//   workflows (spinner clears, footer rendering).
//
// Scope:
//
//   - Fires only on `Edit` and `Write` tool calls.
//   - Only inspects files under `src/` with .ts/.mts/.tsx/.cts
//     extensions. Hooks (.claude/hooks/), git-hooks (.git-hooks/),
//     scripts (scripts/), tests, fixtures, and external/ vendored code
//     are exempt — see EXEMPT_PATH_PATTERNS.
//   - Lines marked `# socket-hook: allow logger` are exempt (canonical
//     opt-out marker, same as path-guard / token-guard / npx-guard).
//   - Lines that look like documentation (comment lines, JSDoc tags,
//     fully backticked code spans) are exempt — handled by the shared
//     `looksLikeDocumentation` heuristic in `_helpers.mts`.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

// Files exempt from the rule. Comments explain why each is excluded.
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  // Hook code itself runs early in the lifecycle and may need to log
  // to stderr before the lib is fully resolvable. Treat hooks as
  // "system code" with their own conventions.
  /\.claude\/hooks\//,
  // Git hooks (.git-hooks/_helpers.mts, pre-commit, etc.) run before
  // workspace deps are guaranteed to be installed.
  /\.git-hooks\//,
  // Build scripts often produce direct stdout for human-readable
  // build output (progress, summary). Migrate these case-by-case
  // outside of this hook's scope.
  /(^|\/)scripts\//,
  // Test files commonly use console.* to capture / assert output.
  /\.(test|spec)\.(m?[jt]s|tsx?|cts|mts)$/,
  /(^|\/)tests?\//,
  /(^|\/)fixtures\//,
  // Vendored upstream sources — never modified for local conventions.
  /(^|\/)external\//,
  /(^|\/)vendor\//,
  /(^|\/)upstream\//,
  // The hook itself.
  /\.claude\/hooks\/logger-guard\//,
]

const LOGGER_LEAK_RE =
  /\b(process\.std(?:err|out)\.write|console\.(?:log|error|warn|info|debug))\s*\(/

const COMMENT_LINE_RE = /^\s*(\*|\/\/|#)/
const JSDOC_TAG_RE = /@(example|param|returns?|see|link)\b/
const SOCKET_HOOK_MARKER_RE = /#\s*socket-hook:\s*allow(?:\s+([\w-]+))?/

function isMarkerSuppressed(line: string): boolean {
  const m = line.match(SOCKET_HOOK_MARKER_RE)
  if (!m) {
    return false
  }
  // No specific rule named → blanket allow. Targeted form must name
  // 'logger' to suppress this scanner.
  return !m[1] || m[1] === 'logger'
}

function isInsideBackticks(line: string): boolean {
  // Find every backtick-delimited span on the line and test if every
  // logger-leak match sits within one. Conservative: any match outside
  // a backtick span fails the check.
  const spans: Array<[number, number]> = []
  for (let i = 0; i < line.length; i += 1) {
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
  const re = new RegExp(LOGGER_LEAK_RE.source, 'g')
  let m: RegExpExecArray | null
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

function looksLikeDocumentation(line: string): boolean {
  if (isMarkerSuppressed(line)) {
    return true
  }
  if (COMMENT_LINE_RE.test(line)) {
    return true
  }
  if (JSDOC_TAG_RE.test(line)) {
    return true
  }
  if (isInsideBackticks(line)) {
    return true
  }
  return false
}

function suggestReplacement(line: string): string {
  return line
    .replace(/\bprocess\.stderr\.write\s*\(/g, 'logger.error(')
    .replace(/\bprocess\.stdout\.write\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.error\s*\(/g, 'logger.error(')
    .replace(/\bconsole\.warn\s*\(/g, 'logger.warn(')
    .replace(/\bconsole\.info\s*\(/g, 'logger.info(')
    .replace(/\bconsole\.debug\s*\(/g, 'logger.debug(')
    .replace(/\bconsole\.log\s*\(/g, 'logger.info(')
}

interface Hit {
  lineNumber: number
  line: string
  suggested: string
}

function scan(source: string): Hit[] {
  const hits: Hit[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    if (!LOGGER_LEAK_RE.test(line)) {
      continue
    }
    if (looksLikeDocumentation(line)) {
      continue
    }
    hits.push({
      lineNumber: i + 1,
      line,
      suggested: suggestReplacement(line),
    })
  }
  return hits
}

function isInScope(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  if (!/\.(m?ts|tsx|cts)$/.test(filePath)) {
    return false
  }
  for (const re of EXEMPT_PATH_PATTERNS) {
    if (re.test(filePath)) {
      return false
    }
  }
  return true
}

function readStdin(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })
}

interface ToolInput {
  tool_name?: string
  tool_input?: {
    file_path?: string
    new_string?: string
    content?: string
  }
}

function emitBlock(filePath: string, hits: Hit[]): void {
  // Hook itself logs to stderr (no lib import at module load — keep
  // hooks self-contained for fast startup). The rule only applies to
  // source code; this output is informational for the agent.
  const out: string[] = []
  out.push('')
  out.push('[logger-guard] Blocked: direct stream write found')
  out.push(
    '  Use `getDefaultLogger()` from `@socketsecurity/lib/logger` instead.',
  )
  out.push(`  File:    ${filePath}`)
  for (const h of hits.slice(0, 3)) {
    out.push(`  Line ${h.lineNumber}: ${h.line.trim()}`)
    out.push(`  Fix:           ${h.suggested.trim()}`)
  }
  if (hits.length > 3) {
    out.push(`  …and ${hits.length - 3} more.`)
  }
  out.push(
    '  Opt-out for one line (rare): append `// # socket-hook: allow logger`.',
  )
  out.push('')
  process.stderr.write(out.join('\n'))
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!isInScope(filePath)) {
    return
  }
  const source =
    payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
  if (!source) {
    return
  }
  const hits = scan(source)
  if (hits.length === 0) {
    return
  }
  emitBlock(filePath, hits)
  process.exitCode = 2
}

main().catch(e => {
  // Fail open on hook bugs.
  process.stderr.write(
    `[logger-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
