#!/usr/bin/env node
// Claude Code PreToolUse hook — no-platform-import-guard.
//
// Blocks Edit/Write tool calls that directly import the platform-specific
// http-request entry points (`/node` or `/browser`) from outside the
// http-request module itself.
//
// Why:
//
//   `src/http-request/node.ts`   — Node.js implementation (uses node:https)
//   `src/http-request/browser.ts` — Browser implementation (uses fetch)
//
//   Importing either one directly hard-codes the platform and bypasses the
//   package.json `"browser"` condition that bundlers (rolldown, vite, webpack)
//   use to swap implementations at build time.  A server-side module importing
//   `/node` is technically OK, but it creates an asymmetry with browser builds
//   and hides the platform choice from tooling.
//
//   The correct approach:
//     — import from the module directory without a platform suffix:
//         import { httpJson } from '../http-request'
//       (requires the package to expose an exports map; if not, talk to the team)
//     — OR add an explicit per-line disable with a reason:
//         // no-platform-http-import: server-only module
//         import { httpJson } from '../http-request/node'
//
// Mirrors the commit-time `socket/no-platform-specific-import` oxlint
// rule.  Catching it at edit time avoids lint failures at commit.
//
// Exit 2 = refuse the tool call.  Exit 0 = allow (fails open on errors).
//
// Bypass: user types `Allow platform-http-import bypass` in a recent turn,
// OR add `// no-platform-http-import: <reason>` on the preceding line.

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const BYPASS_PHRASE = 'Allow platform-http-import bypass'

// Modules that have platform-specific node/browser entry points.
const PLATFORM_MODULES = ['http-request', 'logger'].join('|')

// Matches: from 'some/path/http-request/node', '...logger/browser', etc.
const PLATFORM_IMPORT_RE = new RegExp(
  `\\b(?:import|export)\\b[^\\n]*\\bfrom\\s*['"][^'"]*\\/(${PLATFORM_MODULES})\\/(node|browser)(?:\\.[a-z]+)?['"]`,
)

// Inline disable: `// no-platform-http-import:` on the line before the import.
const INLINE_BYPASS_RE = /\/\/\s*no-platform-http-import\s*:/

const EXEMPT_MODULE_DIRS = ['http-request', 'logger']

export function isExemptPath(filePath: string): boolean {
  const norm = normalizePath(filePath)
  // Files inside the platform-split module dirs are exempt (they form the implementation).
  return EXEMPT_MODULE_DIRS.some(m => norm.includes(`/${m}/`))
}

export function findViolations(
  content: string,
  filePath: string,
): Array<{ line: number; match: string; platform: string }> {
  if (isExemptPath(filePath)) {
    return []
  }
  const lines = content.split('\n')
  const results: Array<{ line: number; match: string; platform: string }> = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const m = PLATFORM_IMPORT_RE.exec(line)
    if (!m) {
      continue
    }
    // Check if the preceding line has an inline bypass comment.
    const prev = i > 0 ? lines[i - 1]! : ''
    if (INLINE_BYPASS_RE.test(prev)) {
      continue
    }
    results.push({ line: i + 1, match: line.trim(), platform: m[1]! })
  }
  return results
}

export const check = editGuard((filePath, content, payload) => {
  const transcriptPath = payload.transcript_path
  if (!content) {
    return undefined
  }
  if (isExemptPath(filePath)) {
    return undefined
  }

  const violations = findViolations(content, filePath)
  if (violations.length === 0) {
    return undefined
  }

  if (bypassPhrasePresent(transcriptPath, BYPASS_PHRASE)) {
    return undefined
  }

  const lines: string[] = []
  lines.push(
    '[no-platform-import-guard] Blocked: platform-specific http-request import.',
  )
  lines.push('')
  lines.push(
    '  The fleet routes HTTP through the platform-agnostic entry point.',
  )
  lines.push(
    '  Importing /node or /browser directly bypasses the bundler\'s "browser"',
  )
  lines.push('  condition and hard-codes the platform.')
  lines.push('')
  for (const v of violations) {
    lines.push(`  Line ${v.line}: ${v.match}`)
  }
  lines.push('')
  lines.push('  Fix: import from the directory (no suffix):')
  lines.push("    import { httpJson } from '../http-request'")
  lines.push('')
  lines.push(
    '  If this file genuinely runs on one platform only, add before the import:',
  )
  lines.push('    // no-platform-http-import: <reason>')
  lines.push('')
  lines.push(`  Or type "${BYPASS_PHRASE}" to bypass for this edit.`)
  return block(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
