#!/usr/bin/env node
// Claude Code PreToolUse hook — no-glob-run-s-guard.
//
// BLOCKS an Edit/Write/MultiEdit to a `package.json` that introduces a
// `run-s <prefix>:*` or `run-p <prefix>:*` glob suffix in a scripts value.
//
// Why: npm-run-all2 resolves `:*` globs via `Object.keys(scripts)`, which
// follows ECMA-262 OrdinaryOwnPropertyKeys §10.1.11 — package.json source
// order, not alphabetical. An order-dependent aggregator using a glob silently
// runs tasks in the order they were written; inserting or reordering a script
// entry breaks it without a test signal. CLAUDE.md "npm-run-all-ordering".
//
// Detection: scans the INCOMING content of a package.json edit for a
// `run-s`/`run-p` value containing `:*`. Does not compare with prior content —
// the check script covers the full-scan; this guard blocks net-new introductions.
//
// Scope: only `package.json` files (any depth). Skips vendor/upstream trees
// and node_modules. Applies only inside a fleet repo (convention guard).
//
// Bypass: `Allow run-s glob bypass` typed verbatim in a recent user turn (for
// the case where the aggregator is provably order-independent).
//
// Exit codes: 0 pass, 2 block. Fails open on any error.

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const BYPASS_PHRASE = 'Allow run-s glob bypass' as const

// Matches a `run-s <x>:*` or `run-p <x>:*` pattern inside a JSON string value.
// The `:*` glob suffix is npm-run-all2's wildcard form for task expansion. The
// glob may appear anywhere in the argument list (`run-s build build-mcpb:*`),
// so scan to the end of the unquoted value, not just the first argument.
// require-regex-comment: detects run-s/run-p `:*` glob in package.json scripts values.
const GLOB_RE = /\brun-[sp]\s[^"'\n]*:\*/

export interface GlobDetection {
  readonly detected: boolean
  readonly fragment: string
}

export function isPackageJson(filePath: string): boolean {
  return (
    (normalizePath(filePath).endsWith('/package.json') ||
      filePath === 'package.json') &&
    !normalizePath(filePath).includes('/node_modules/')
  )
}

export function detectGlob(content: string): GlobDetection {
  const m = GLOB_RE.exec(content)
  if (!m) {
    return { detected: false, fragment: '' }
  }
  return { detected: true, fragment: m[0].trimEnd() }
}

export const check = editGuard((filePath, content, payload) => {
  if (!isPackageJson(filePath)) {
    return undefined
  }
  if (!isFleetTarget(payload)) {
    return undefined
  }
  const text = content ?? ''
  if (!text) {
    return undefined
  }
  const detection = detectGlob(text)
  if (!detection.detected) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      `[no-glob-run-s-guard] Blocked: \`${detection.fragment}\` uses a \`:*\` glob in a package.json scripts value.`,
      '',
      '  npm-run-all2 resolves `:*` globs via `Object.keys(scripts)`, which returns keys in',
      '  package.json SOURCE ORDER (ECMA-262 §10.1.11) — not alphabetical. An order-dependent',
      '  aggregator using a glob breaks silently whenever a script entry is reordered or inserted.',
      '',
      '  Fix: list tasks explicitly for order-dependent aggregators:',
      '    "gen": "run-s gen:logo gen:socket-icon gen:showcase"',
      // oxlint-disable-next-line socket/no-glob-in-ordered-run-s -- example string in this guard's own message.
      '    not: "gen": "run-s gen:*"',
      '',
      '  If every task under the prefix is order-independent, you may bypass:',
      `    type "${BYPASS_PHRASE}" in a recent message.`,
      '',
      '  Reference: docs/agents.md/fleet/npm-run-all-ordering.md',
    ].join('\n') + '\n',
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
