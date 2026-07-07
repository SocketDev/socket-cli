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

// Logger-leak detection (the FORBIDDEN_LOGGER_CALLS table + the AST walk) is
// shared with the commit-time scanLoggerLeaks via the gate-free
// _shared/logger-leaks.mts, so the edit-time and commit-time gates agree.
import {
  findLoggerDecoration,
  findLoggerLeaks,
} from '../../../../.git-hooks/_shared/logger-leaks.mts'
import type { LoggerDecoration } from '../../../../.git-hooks/_shared/logger-leaks.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { lineIsSuppressed } from '../_shared/markers.mts'

const EXEMPT_PATH_PATTERNS: RegExp[] = [
  /\.claude\/hooks\//,
  /\.git-hooks\//,
  // The dep-0 bootstrap (`bootstrap/fleet.mjs`, `bootstrap/prepare.mts`) is
  // bare by design — it never imports socket-lib (it's the fetcher that runs
  // before any dep exists), so it must call `console.*` directly. Relocating it
  // out of `scripts/` lost the `scripts/` exemption below; restore it here.
  /(?:^|\/)bootstrap\//,
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

export function emitBlock(filePath: string, hits: Hit[]): string {
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
    '  Opt-out for one line (rare): append `// socket-lint: allow console` for a ' +
      '`console.*` call, or `// socket-lint: allow process-stdio` for a raw ' +
      '`process.std{out,err}.write` (the id must match the call kind).',
  )
  out.push('')
  return out.join('\n')
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
  // Match TypeScript source extensions: .ts, .mts, .cts, and .tsx.
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
    // Per-line allow marker, keyed by leak kind so the edit-time guard agrees
    // with the pre-push `scanLoggerLeaks`: `console.*` waives with
    // `// socket-lint: allow console`, raw `process.std*.write` waives with the
    // more deliberate `// socket-lint: allow process-stdio`. The marker must be
    // on the same source line as the call.
    const rule = leak.fullCall.startsWith('process.')
      ? 'process-stdio'
      : 'console'
    /* c8 ignore next - AST line numbers are always within the source range */
    const sourceLine = lines[leak.line - 1] ?? ''
    if (lineIsSuppressed(sourceLine, rule)) {
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

// Decoration applies more broadly than the console-leak rule: scripts/ and
// .claude/hooks/ legitimately call console in a few spots (hence exempt above)
// but must NOT hand-roll logger prefixes. So decoration has its own, narrower
// exempt set — external/vendored code, test files (which build expected-output
// fixtures with glyphs), and the logger's own implementation.
const DECORATION_EXEMPT_PATTERNS: RegExp[] = [
  /(?:^|\/)external\//,
  /(?:^|\/)vendor\//,
  /(?:^|\/)upstream\//,
  /(?:^|\/)fixtures\//,
  /(?:^|\/)src\/logger\//,
  /\.(?:spec|test)\.(?:m?[jt]s|tsx?|cts|mts)$/,
]

export function isInDecorationScope(filePath: string): boolean {
  // Same extension gate as isInScope: only .ts, .mts, .cts, and .tsx files.
  if (!filePath || !/\.(?:m?ts|tsx|cts)$/.test(filePath)) {
    return false
  }
  for (let i = 0, { length } = DECORATION_EXEMPT_PATTERNS; i < length; i += 1) {
    if (DECORATION_EXEMPT_PATTERNS[i]!.test(filePath)) {
      return false
    }
  }
  return true
}

export function scanDecoration(source: string): LoggerDecoration[] {
  const lines = source.split('\n')
  const out: LoggerDecoration[] = []
  for (const deco of findLoggerDecoration(source)) {
    /* c8 ignore next - AST line numbers are always within the source range */
    const sourceLine = lines[deco.line - 1] ?? ''
    if (lineIsSuppressed(sourceLine, 'logger-decoration')) {
      continue
    }
    out.push(deco)
  }
  return out
}

export function emitDecorationBlock(
  filePath: string,
  decos: readonly LoggerDecoration[],
): string {
  const out: string[] = []
  out.push('')
  out.push('[logger-guard] Blocked: hand-rolled logger decoration')
  out.push(
    '  The logger method owns its glyph; group()/substep() own indentation.',
  )
  out.push(`  File:    ${filePath}`)
  for (let i = 0, { length } = decos; i < length && i < 3; i += 1) {
    const d = decos[i]!
    out.push(`  Line ${d.line}: ${d.text}`)
    if (d.kind === 'glyph') {
      out.push(
        /* c8 ignore next - glyph is always a GLYPH_OWNER key so ownerMethod is always defined */
        `  Fix:           drop the \`${d.glyph}\` and call \`logger.${d.ownerMethod ?? 'fail'}(...)\` (the method renders the glyph).`,
      )
    } else if (d.kind === 'indent') {
      out.push(
        '  Fix:           wrap items in `logger.group()`/`logger.groupEnd()` (or use `logger.substep()`) — drop the leading spaces.',
      )
    } else {
      out.push(
        '  Fix:           use `logger.substep(...)` for an indented sub-item — drop the leading bullet.',
      )
    }
  }
  if (decos.length > 3) {
    out.push(`  …and ${decos.length - 3} more.`)
  }
  out.push(
    '  Opt-out for one line (rare): append `// socket-lint: allow logger-decoration`.',
  )
  out.push('')
  return out.join('\n')
}

export const check = editGuard(
  (filePath, content) => {
    const source = content ?? ''
    if (!source) {
      return undefined
    }
    const blocks: string[] = []
    if (isInScope(filePath)) {
      const hits = scan(source)
      if (hits.length > 0) {
        blocks.push(emitBlock(filePath, hits))
      }
    }
    if (isInDecorationScope(filePath)) {
      const decos = scanDecoration(source)
      if (decos.length > 0) {
        blocks.push(emitDecorationBlock(filePath, decos))
      }
    }
    if (blocks.length === 0) {
      return undefined
    }
    return block(blocks.join('\n'))
  },
  { fleetOnly: true },
)

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
