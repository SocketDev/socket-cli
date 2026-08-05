#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook — crlf-split-nudge.
 *
 * `text.split('\n')` on a file written with CRLF endings leaves a trailing
 * `\r` on every line. The damage is quiet: `line.trim()` still looks right, a
 * `startsWith` still matches, and the bug only surfaces later at an
 * `endsWith`, an equality check, a parse, or a value that silently carries an
 * invisible character into a generated file.
 *
 * The fleet's answer is `splitLines`, which normalizes first:
 *
 *   text.replace(/\r\n/g, '\n').split('\n')
 *
 * Scoped deliberately. Splitting a string BUILT IN MEMORY — a compiler's
 * output, a template literal, a joined array — can never contain CRLF, and
 * the fleet has hundreds of those. Firing on all of them would be noise
 * nobody reads. So this only speaks up when the same file also reads from
 * disk, which is where the hazard actually lives. That is a heuristic, not a
 * proof, which is exactly why it is a nudge and never a block.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// Pre-flight triggers: the dispatcher skips importing this hook unless the raw
// payload contains this substring. Every pattern below requires a `.split(`,
// so it is a necessary substring of any nudge-worthy write.
export const triggers: readonly string[] = ['.split(']

// The surfaces that must spell the raw split out in order to define or
// discuss it — `splitLines` itself is implemented with one.
const SELF_EXEMPT = [
  '.claude/hooks/fleet/crlf-split-nudge/',
  '.git-hooks/_shared/scan-core.mts',
  'docs/agents.md/fleet/hook-registry.md',
]

// A raw newline split, single- or double-quoted.
const RAW_SPLIT_RE = /\.split\((['"])\\n\1\)/

// Reading from disk is what makes CRLF reachable. Anything built in memory
// cannot carry it, so without one of these the file is not at risk.
const READS_FILE_RE =
  /\breadFileSync\s*\(|\breadFile\s*\(|\breadTextFile\s*\(|\bBun\.file\s*\(/

/**
 * True when this path is one of the surfaces that must show a raw split.
 */
export function isSelfExempt(filePath: string): boolean {
  const normalized = normalizePath(filePath)
  return SELF_EXEMPT.some(fragment => normalized.includes(fragment))
}

/**
 * True when `content` splits on a bare newline AND reads a file, the pairing
 * where a CRLF file would actually reach the split.
 */
export function hasCrlfUnsafeSplit(content: string): boolean {
  return RAW_SPLIT_RE.test(content) && READS_FILE_RE.test(content)
}

export const check = editGuard((filePath, content) => {
  if (!content || isSelfExempt(filePath) || !hasCrlfUnsafeSplit(content)) {
    return undefined
  }
  return notify(
    [
      "[crlf-split-nudge] `.split('\\n')` in a file that also reads from disk.",
      '',
      '  A CRLF file leaves a trailing `\\r` on every line. It survives',
      '  `trim()` and `startsWith`, then breaks a later `endsWith`, equality',
      '  check, or parse — or rides invisibly into generated output.',
      '',
      '  Use the normalizing split:',
      '',
      "    text.replace(/\\r\\n/g, '\\n').split('\\n')",
      '',
      '  `splitLines` in .git-hooks/_shared/scan-core.mts already does this.',
      '',
      '  Splitting a string built in memory is safe — a compiler result, a',
      '  template literal, a joined array cannot contain CRLF. Ignore this',
      '  when that is what the split is reading.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  triggers,
  type: 'nudge',
})

void runHook(hook, import.meta.url)
