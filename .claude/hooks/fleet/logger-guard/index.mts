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
//   `@socketsecurity/lib-stable/logger/default` for every output. Direct stream
//   writes bypass color/theme handling, indentation tracking, stream
//   redirection in tests, and spinner-counter increments — producing
//   inconsistent output that breaks layout-sensitive workflows.
//
// Scope:
//
//   - Fires only on `Edit` and `Write` tool calls.
//   - Only inspects `.ts` / `.mts` / `.cts` / `.tsx` source files.
//     Hooks, git-hooks, scripts, tests, fixtures, external/vendored
//     code are exempt — see EXEMPT_PATH_PATTERNS.
//   - Lines marked `// socket-lint: allow console` are exempt.
//
// AST-based detector (vendored acorn-wasm in `../_shared/acorn/`).
// Replaced the regex implementation that had to compensate for
// string-literal / comment / template-literal false positives via
// `looksLikeDocumentation` heuristics — the parser handles all of
// that intrinsically because it only reaches CallExpression nodes
// for actual calls, not text-shapes that look like calls.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

// Logger-leak detection (the FORBIDDEN_LOGGER_CALLS table + the AST walk) is
// shared with the commit-time scanLoggerLeaks via the gate-free
// _shared/logger-leaks.mts, so the edit-time and commit-time gates agree.
import { findLoggerLeaks } from '../../../../.git-hooks/_shared/logger-leaks.mts'
import { lineIsSuppressed } from '../_shared/markers.mts'
import { withEditGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

const EXEMPT_PATH_PATTERNS: RegExp[] = [
  /\.claude\/hooks\//,
  /\.git-hooks\//,
  /(?:^|\/)scripts\//,
  /\.(?:spec|test)\.(?:m?[jt]s|tsx?|cts|mts)$/,
  /(?:^|\/)tests?\//,
  /(?:^|\/)fixtures\//,
  /(?:^|\/)external\//,
  /(?:^|\/)vendor\//,
  /(?:^|\/)upstream\//,
  // The logger is its own owner — these files implement the Logger
  // class + its browser shim and must call console.* directly.
  /(?:^|\/)src\/logger\//,
]

// The forbidden-call table + AST detector live in the shared
// _shared/logger-leaks.mts (FORBIDDEN_LOGGER_CALLS / findLoggerLeaks), so the
// commit-time scanLoggerLeaks and this edit-time guard use one source.

export function emitBlock(filePath: string, hits: Hit[]): void {
  const out: string[] = []
  out.push('')
  out.push('[logger-guard] Blocked: direct stream write found')
  out.push(
    '  Use `getDefaultLogger()` from `@socketsecurity/lib-stable/logger/default` instead.',
  )
  out.push(`  File:    ${filePath}`)
  for (const h of hits.slice(0, 3)) {
    out.push(`  Line ${h.line}: ${h.text}`)
    out.push(
      `  Fix:           replace \`${h.fullCall}(\` with \`${h.replacement}(\``,
    )
  }
  if (hits.length > 3) {
    out.push(`  …and ${hits.length - 3} more.`)
  }
  out.push(
    '  Opt-out for one line (rare): append `// socket-lint: allow console`.',
  )
  out.push('')
  logger.error(out.join('\n'))
}

interface Hit {
  line: number
  text: string
  fullCall: string
  replacement: string
}

export function isInScope(filePath: string): boolean {
  if (!filePath) {
    return false
  }
  if (!/\.(?:m?ts|tsx|cts)$/.test(filePath)) {
    return false
  }
  for (let i = 0, { length } = EXEMPT_PATH_PATTERNS; i < length; i += 1) {
    const re = EXEMPT_PATH_PATTERNS[i]!
    if (re.test(filePath)) {
      return false
    }
  }
  return true
}

export function scan(source: string): Hit[] {
  const lines = source.split('\n')
  const hits: Hit[] = []
  for (const leak of findLoggerLeaks(source)) {
    // Per-line allow marker: `// socket-lint: allow console`. The marker
    // must appear on the same source line as the call.
    const sourceLine = lines[leak.line - 1] ?? ''
    if (lineIsSuppressed(sourceLine, 'console')) {
      continue
    }
    hits.push({
      line: leak.line,
      text: leak.text,
      fullCall: leak.fullCall,
      replacement: leak.replacement,
    })
  }
  hits.sort((a, b) => a.line - b.line)
  return hits
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction, and fail-open on any throw.
await withEditGuard((filePath, content) => {
  if (!isInScope(filePath)) {
    return
  }
  const source = content ?? ''
  if (!source) {
    return
  }
  const hits = scan(source)
  if (hits.length === 0) {
    return
  }
  emitBlock(filePath, hits)
  process.exitCode = 2
}, { fleetOnly: true })
