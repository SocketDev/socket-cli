#!/usr/bin/env node
// Claude Code PreToolUse hook — c8-ignore-reason-guard.
//
// Blocks Edit/Write that introduces a c8 / v8 coverage-ignore directive
// WITHOUT a reason. The fleet rule (CLAUDE.md "c8 / v8 coverage ignore
// directives", docs/agents.md/fleet/c8-ignore-directives.md): a coverage
// ignore is only for external-library paths + genuinely-unreachable
// branches, and every directive must say WHY in the same comment so a
// future reader can tell a principled ignore from a coverage dodge on
// core logic.
//
// Also blocks multi-line `next N` (N >= 2) even WITH a reason: c8/v8 count
// physical lines, not statements, so `next 3` silently drops covered lines.
// The fix is a start/stop bracket; single-line `next` / `next 1` is fine.
//
// Required shapes (a reason is any non-empty text after `-` / `—`):
//   c8 ignore next - external lib error shape
//   c8 ignore start - third-party throw path  …  c8 ignore stop
//   v8 ignore next - unreachable: exhaustive switch default
//
// Blocked shapes:
//   c8 ignore next                  (no reason)
//   v8 ignore start                 (no reason)
//   c8 ignore next 3 - reason       (multi-line next N — use start/stop)
//
// `stop` markers need no reason (the paired `start` carries it).
//
// Exit codes: 0 pass, 2 block. Fails open on its own errors.
//
// Bypass: `Allow c8-ignore-reason bypass` in a recent user turn.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow c8-ignore-reason bypass'

// A c8/v8 ignore directive. Captures the kind (next|start|stop) and the
// trailing text after the count, so the reason check can run on what's
// left. `stop` is matched but exempted (its paired `start` carries the
// reason).
const IGNORE_DIRECTIVE_RE =
  /\/\*\s*(?:c8|v8)\s+ignore\s+(next|start|stop)\b([^*]*)\*\//g

// Only police source we'd actually cover. Skip non-TS/JS + the usual
// non-source trees.
const SOURCE_EXT_RE = /\.(?:c|m)?[jt]sx?$/
const EXEMPT_PATH_RE = /(?:^|\/)(?:test|tests|fixtures|external|vendor)\//

// A finding is either a directive with no reason (`no-reason`) or a
// multi-line `next N` (N >= 2), which c8/v8 miscount (the reporter counts
// physical lines, not statements, silently dropping covered lines) —
// `next-n` must be rewritten as a start/stop bracket regardless of reason.
export type FindingKind = 'no-reason' | 'next-n'

export interface Finding {
  readonly line: number
  readonly text: string
  readonly kind: FindingKind
}

export function findUnexplainedIgnores(source: string): Finding[] {
  const findings: Finding[] = []
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    IGNORE_DIRECTIVE_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = IGNORE_DIRECTIVE_RE.exec(line)) !== null) {
      const kind = match[1]!
      if (kind === 'stop') {
        continue
      }
      const rawTail = match[2]!
      // A multi-line `next N` (N >= 2) is broken even WITH a reason: c8/v8
      // count physical lines, not statements, so `next 3` silently drops
      // covered lines. Require a start/stop bracket instead. Bare `next`
      // and `next 1` (a single physical line) stay allowed.
      const countMatch = /^\s*(\d+)/.exec(rawTail)
      if (kind === 'next' && countMatch && Number(countMatch[1]) >= 2) {
        findings.push({ line: i + 1, text: line.trim(), kind: 'next-n' })
        continue
      }
      // After the kind + optional count, a reason is `- <text>` or
      // `— <text>`. Strip a leading count (`next 3`) first.
      const tail = rawTail.replace(/^\s*\d+\s*/, '').trim()
      const hasReason = /^[-—]\s*\S/.test(tail)
      if (!hasReason) {
        findings.push({ line: i + 1, text: line.trim(), kind: 'no-reason' })
      }
    }
  }
  return findings
}

export function isInScope(filePath: string): boolean {
  return SOURCE_EXT_RE.test(filePath) && !EXEMPT_PATH_RE.test(filePath)
}

await withEditGuard((filePath, content, payload) => {
  if (!isInScope(filePath)) {
    return
  }
  const source = content ?? ''
  if (!source) {
    return
  }
  const findings = findUnexplainedIgnores(source)
  if (findings.length === 0) {
    return
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return
  }
  const lines = findings
    .map(f => {
      const why =
        f.kind === 'next-n'
          ? 'multi-line `next N` miscounts; use start/stop'
          : 'no reason'
      return `  line ${f.line} (${why}): ${f.text}`
    })
    .join('\n')
  const hasNextN = findings.some(f => f.kind === 'next-n')
  const hasNoReason = findings.some(f => f.kind === 'no-reason')
  const guidance: string[] = []
  if (hasNoReason) {
    guidance.push(
      '  Every `c8 ignore` / `v8 ignore` needs a reason in the same comment:',
      '    /* c8 ignore next - external lib error shape */',
      '  A reason lets a reader tell a principled ignore (external lib,',
      '  unreachable branch) from a coverage dodge on core logic — which the',
      '  fleet forbids (write a test instead).',
    )
  }
  if (hasNextN) {
    if (guidance.length) {
      guidance.push('')
    }
    guidance.push(
      '  `c8/v8 ignore next N` (N >= 2) is broken for multi-line bodies — the',
      '  reporter counts physical lines, not statements, so it silently drops',
      '  covered lines. Bracket the construct instead:',
      '    /* c8 ignore start - <reason> */ … /* c8 ignore stop */',
      '  Single-line `next` (or `next 1`) is fine.',
    )
  }
  logger.error(
    [
      '[c8-ignore-reason-guard] Blocked: invalid coverage-ignore directive.',
      '',
      lines,
      '',
      ...guidance,
      '',
      '  See docs/agents.md/fleet/c8-ignore-directives.md.',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a recent message.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
