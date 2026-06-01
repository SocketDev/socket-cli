#!/usr/bin/env node
// Claude Code PreToolUse hook — no-file-scope-oxlint-disable-guard.
//
// Blocks Edit/Write tool calls that introduce a file-scope
// `oxlint-disable <rule>` comment. Always force inline
// `oxlint-disable-next-line <rule> -- <reason>` per call site so the
// exemption is independently justified next to the code it covers.
//
// Why: a file-scope `/* oxlint-disable socket/no-console-prefer-logger */`
// at the top of a file silently exempts every line of that file from
// a fleet rule — including lines added later by editors who never
// saw the disable. Inline `-next-line` forces a fresh justification
// per call site, which surfaces in code review + `git blame`.
//
// Recognized banned shapes:
//   /* oxlint-disable <rule> */            (no -next-line suffix)
//   // oxlint-disable <rule>                (line comment, no -next-line)
//
// Allowed shapes (passes through):
//   /* oxlint-disable-next-line <rule> */   (block, per call)
//   // oxlint-disable-next-line <rule>       (line, per call)
//   /* oxlint-enable <rule> */               (re-enables; pairs with disables)
//
// Exemption: files under `.config/fleet/oxlint-plugin/rules/` and
// `.config/fleet/oxlint-plugin/test/` are allowed to file-scope-disable
// their own rule (the banned shape is lookup-table data in the rule
// definition or in test fixtures).
//
// Reads PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Exit codes:
//   0 — pass.
//   2 — block (at least one file-scope oxlint-disable found).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'

const logger = getDefaultLogger()

const FILE_SCOPE_DISABLE_RE =
  /^[ \t]*(?:\/\*|\/\/)[ \t]*oxlint-disable(?!-next-line)[ \t]+/

// Plugin-internal rule + test files are exempt — the banned shape is
// lookup-table data in the rule definition or test fixture.
const EXEMPT_PATH_SUFFIXES: readonly string[] = [
  '.config/fleet/oxlint-plugin/rules/',
  '.config/fleet/oxlint-plugin/test/',
]

interface Finding {
  readonly line: number
  readonly text: string
}

export function findFileScopeDisables(text: string): Finding[] {
  const findings: Finding[] = []
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (FILE_SCOPE_DISABLE_RE.test(line)) {
      findings.push({ line: i + 1, text: line.trim() })
    }
  }
  return findings
}

export function isExemptPath(filePath: string): boolean {
  for (let i = 0, { length } = EXEMPT_PATH_SUFFIXES; i < length; i += 1) {
    if (filePath.includes(EXEMPT_PATH_SUFFIXES[i]!)) {
      return true
    }
  }
  return false
}

if (process.env['SOCKET_NO_FILE_SCOPE_OXLINT_DISABLE_GUARD_DISABLED']) {
  process.exit(0)
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content) => {
  if (isExemptPath(filePath)) {
    return
  }
  const newContent = content ?? ''
  const findings = findFileScopeDisables(newContent)
  if (findings.length === 0) {
    return
  }
  const lines: string[] = []
  lines.push(
    '🚨 no-file-scope-oxlint-disable-guard: blocked Edit/Write — file-scope `oxlint-disable` is forbidden.',
  )
  lines.push('')
  lines.push(`File:  ${filePath || '<unknown>'}`)
  lines.push('')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(`  Line ${f.line}: ${f.text}`)
  }
  lines.push('')
  lines.push(
    'Fix: move each disable to `oxlint-disable-next-line <rule> -- <reason>`',
  )
  lines.push(
    '     on the specific line that needs it. Each exemption must carry its own',
  )
  lines.push('     justification next to the code it covers.')
  lines.push('')
  lines.push(
    "If the entire file legitimately can't comply, the file needs a refactor",
  )
  lines.push('— not a blanket exemption.')
  logger.error(lines.join('\n') + '\n')
  process.exitCode = 2
})
