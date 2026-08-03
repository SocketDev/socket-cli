#!/usr/bin/env node
/*
 * @file Claude Code PreToolUse hook — memory-enforcement-stamp-guard.
 *
 *   Blocks a Write / Edit / MultiEdit to a durable memory ENTRY
 *   (`…/.claude/projects/<slug>/memory/<name>.md`) whose frontmatter carries no
 *   `enforcement:` key. `scripts/fleet/check/memories-are-codified.mts` catches
 *   the same gap at commit time; this guard stops it being written in the first
 *   place, so a stamped store stays stamped.
 *
 *   Purely MECHANICAL: the key must be present and non-empty. Whether the
 *   disposition names a REAL enforcer is a judgment call and belongs to
 *   `uncodified-lesson-nudge` (a Stop hook, non-blocking, deliberately a
 *   separate surface — one surface per concern). Do not merge the two.
 *
 *   Out of scope, never blocked: the store's `MEMORY.md` index (it carries no
 *   frontmatter and states no rule) and any markdown file outside a memory
 *   store.
 *
 *   Fails OPEN on a parse / payload error, like its siblings.
 *
 * Bypass: `Allow memory-enforcement-stamp bypass`.
 */

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import {
  hasEnforcementStamp,
  isMemoryEntryPath,
} from '../_shared/memory-store.mts'

/**
 * The three accepted dispositions, verbatim, so the caller can copy one.
 */
export const ACCEPTED_DISPOSITIONS = [
  'enforcement: .claude/hooks/fleet/<name>     # a hook, lint rule, or check ref',
  'enforcement: deferred #<task>               # a tracked follow-up',
  'enforcement: n/a — <reason>                 # a pure-preference lesson',
] as const

/**
 * The block message: What / Where / Saw vs. wanted / Fix.
 */
export function stampBlockMessage(filePath: string): string {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1)
  return [
    '🚨 memory-enforcement-stamp-guard: refusing a memory entry with no',
    '   `enforcement:` disposition.',
    '',
    `Where: ${name}`,
    '',
    'Saw:    frontmatter with no `enforcement:` key.',
    'Wanted: every codifiable memory declares how it is enforced, so the store',
    '        never drifts into policy-on-paper.',
    '',
    'Fix: add ONE of these lines to the frontmatter:',
    '',
    ...ACCEPTED_DISPOSITIONS.map(line => `  ${line}`),
    '',
    '     Detail: docs/agents.md/fleet/memory-codification.md.',
  ].join('\n')
}

export const check = editGuard((filePath, content) => {
  if (!isMemoryEntryPath(filePath)) {
    return undefined
  }
  // No readable written text (a MultiEdit shape the payload reader can't
  // flatten) — fail open rather than block on a guess.
  if (typeof content !== 'string' || !content) {
    return undefined
  }
  if (hasEnforcementStamp(content)) {
    return undefined
  }
  return block(stampBlockMessage(filePath))
})

export const hook = defineHook({
  bypass: ['memory-enforcement-stamp'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
