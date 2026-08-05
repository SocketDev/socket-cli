#!/usr/bin/env node
// Claude Code PreToolUse hook — no-designated-ignore-guard.
//
// Blocks Edit/Write tool calls that ADD an ignore marker for a designated
// lint rule — one whose findings must be fixed, never excused. The first
// designee is socket/max-comment-block-lines: a long comment block is fixed
// by shortening it or moving the depth into `docs/agents.md/**`, and a JSDoc
// documentation block already gets the doubled doc budget, so an ignore
// marker for it is always the wrong move.
//
// Detection is ADDITIVE: a marker already present in the edited region
// (Edit `old_string`) or on disk (Write target) passes through — the guard
// fires only when the about-to-land content carries MORE designated markers
// than the content it replaces.
//
// Recognized banned shapes, per designated rule:
//   // socket-lint: allow <allow-id> ...        (the rule's own opt-out)
//   /* oxlint-disable <rule-id> */               (any oxlint disable form
//   // oxlint-disable-next-line <rule-id>         naming the rule)
//
// Exemption: the oxlint plugin's own rule subtrees and this guard's own
// files — the banned shape is lookup-table data or test fixture there.
//
// Reads PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write"|"MultiEdit",
//     "tool_input": { "file_path": "...", ... } }
//
// Exit codes:
//   0 — pass.
//   2 — block, a designated ignore marker was added.
//
// Bypass: `Allow designated-ignore bypass`. Fails open on malformed payloads.

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { readFilePath } from '../_shared/payload.mts'
import type { ToolCallPayload, ToolInput } from '../_shared/payload.mts'

export interface DesignatedRule {
  // The `socket-lint: allow <id>` opt-out id the rule honors.
  readonly allowId: string
  // The oxlint rule id an `oxlint-disable` comment would name.
  readonly ruleId: string
  // The real fix, stated in the block message.
  readonly fix: string
}

// Rules whose findings are always fixable — an ignore marker for them is the
// reach-for-ignore reflex this guard exists to stop. Grows by fleet decision,
// one entry per rule.
export const DESIGNATED_RULES: readonly DesignatedRule[] = [
  {
    allowId: 'long-comment-block',
    ruleId: 'socket/max-comment-block-lines',
    fix: 'shorten the block or move the depth into docs/agents.md/**, linked from a one-line pointer. A JSDoc doc block already gets the doubled doc budget.',
  },
]

// The banned shape is lookup-table data or test fixture under these paths.
const EXEMPT_PATH_SUFFIXES: readonly string[] = [
  '.config/fleet/oxlint-plugin/fleet/',
  '.config/repo/oxlint-plugin/',
  '.claude/hooks/fleet/no-designated-ignore-guard/',
  'test/repo/integration/hooks/no-designated-ignore-guard',
]

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function markerPatterns(rule: DesignatedRule): RegExp[] {
  return [
    new RegExp(
      `socket-lint:\\s*allow\\s+${escapeRegExp(rule.allowId)}(?![\\w-])`,
    ),
    new RegExp(
      `oxlint-disable(?:-next-line|-line)?\\b[^\\n]*${escapeRegExp(rule.ruleId)}(?![\\w-])`,
    ),
  ]
}

export function countDesignatedMarkers(
  text: string,
  rule: DesignatedRule,
): number {
  const patterns = markerPatterns(rule)
  let count = 0
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (let p = 0, plen = patterns.length; p < plen; p += 1) {
      if (patterns[p]!.test(line)) {
        count += 1
        break
      }
    }
  }
  return count
}

export function isExemptPath(filePath: string): boolean {
  for (let i = 0, { length } = EXEMPT_PATH_SUFFIXES; i < length; i += 1) {
    if (filePath.includes(EXEMPT_PATH_SUFFIXES[i]!)) {
      return true
    }
  }
  return false
}

export interface EditPair {
  readonly prior: string
  readonly next: string
}

// Resolve what the edit replaces (prior) and what lands (next), per tool.
// Write compares against the on-disk file so a full-file rewrite that merely
// RETAINS an existing marker passes.
function readEditPair(payload: ToolCallPayload): EditPair | undefined {
  const input: ToolInput = payload?.tool_input ?? {}
  const tool = payload?.tool_name
  if (tool === 'Write') {
    if (typeof input.content !== 'string') {
      return undefined
    }
    const onDisk = safeReadFileSync(readFilePath(payload) ?? '')
    return {
      prior: typeof onDisk === 'string' ? onDisk : '',
      next: input.content,
    }
  }
  if (tool === 'Edit') {
    if (typeof input.new_string !== 'string') {
      return undefined
    }
    return {
      prior: typeof input.old_string === 'string' ? input.old_string : '',
      next: input.new_string,
    }
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    let prior = ''
    let next = ''
    for (let i = 0, { length } = input.edits; i < length; i += 1) {
      const edit = input.edits[i]
      if (!edit || typeof edit !== 'object') {
        continue
      }
      const { new_string: n, old_string: o } = edit as Record<string, unknown>
      if (typeof o === 'string') {
        prior += `${o}\n`
      }
      if (typeof n === 'string') {
        next += `${n}\n`
      }
    }
    return { prior, next }
  }
  return undefined
}

export interface Finding {
  readonly rule: DesignatedRule
  readonly added: number
}

export function findAddedDesignatedIgnores(pair: EditPair): Finding[] {
  const findings: Finding[] = []
  for (let i = 0, { length } = DESIGNATED_RULES; i < length; i += 1) {
    const rule = DESIGNATED_RULES[i]!
    const before = countDesignatedMarkers(pair.prior, rule)
    const after = countDesignatedMarkers(pair.next, rule)
    if (after > before) {
      findings.push({ rule, added: after - before })
    }
  }
  return findings
}

export async function check(payload: ToolCallPayload): Promise<GuardResult> {
  const tool = payload?.tool_name
  if (tool !== 'Edit' && tool !== 'MultiEdit' && tool !== 'Write') {
    return undefined
  }
  const filePath = readFilePath(payload)
  if (!filePath || isExemptPath(filePath)) {
    return undefined
  }
  const pair = readEditPair(payload)
  if (!pair) {
    return undefined
  }
  const findings = findAddedDesignatedIgnores(pair)
  if (findings.length === 0) {
    return undefined
  }
  const lines: string[] = []
  lines.push(
    '🚨 no-designated-ignore-guard: blocked Edit/Write — this rule is designated fix-only; ignore markers for it are never added.',
  )
  lines.push('')
  lines.push(`File:  ${filePath}`)
  lines.push('')
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    lines.push(
      `  ${f.rule.ruleId} (allow id: ${f.rule.allowId}) — ${f.added} marker(s) added.`,
    )
    lines.push(`  Fix: ${f.rule.fix}`)
    lines.push('')
  }
  lines.push(
    'Existing markers in the file are grandfathered; only additions are blocked.',
  )
  return block(lines.join('\n') + '\n')
}

export const hook = defineHook({
  bypass: ['designated-ignore'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
