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

import { findMemberCalls } from '../_shared/acorn/index.mts'
import type { MemberCallSite } from '../_shared/acorn/index.mts'
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

// The forbidden calls and the canonical logger replacement for each.
// Two-segment chains (`console.log`) and three-segment chains
// (`process.stderr.write`) — `findMemberCalls` handles both.
const FORBIDDEN_CALLS: Array<{
  object: string
  property: string
  replacement: string
}> = [
  { object: 'console', property: 'log', replacement: 'logger.info' },
  { object: 'console', property: 'error', replacement: 'logger.error' },
  { object: 'console', property: 'warn', replacement: 'logger.warn' },
  { object: 'console', property: 'info', replacement: 'logger.info' },
  { object: 'console', property: 'debug', replacement: 'logger.debug' },
  { object: 'process.stderr', property: 'write', replacement: 'logger.error' },
  { object: 'process.stdout', property: 'write', replacement: 'logger.info' },
]

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
  const hits: Hit[] = []
  const lines = source.split('\n')
  for (let i = 0, { length } = FORBIDDEN_CALLS; i < length; i += 1) {
    const spec = FORBIDDEN_CALLS[i]!
    const matches: MemberCallSite[] = findMemberCalls(
      source,
      spec.object,
      spec.property,
    )
    for (let i = 0, { length } = matches; i < length; i += 1) {
      const m = matches[i]!
      // Per-line allow marker: `// socket-lint: allow console`. The
      // marker has to appear on the same source line as the call.
      const sourceLine = lines[m.line - 1] ?? ''
      if (lineIsSuppressed(sourceLine, 'console')) {
        continue
      }
      hits.push({
        line: m.line,
        text: m.text,
        fullCall: `${spec.object}.${spec.property}`,
        replacement: spec.replacement,
      })
    }
  }
  // Multiple FORBIDDEN_CALLS iterations may produce out-of-order
  // results when several different calls land on different lines.
  // Sort by line for readable output.
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
})
