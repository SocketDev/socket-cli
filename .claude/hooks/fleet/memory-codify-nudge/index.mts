#!/usr/bin/env node
// Claude Code PostToolUse(Edit/Write) hook — memory-codify-nudge.
//
// Fires the moment a memory-store file is written. A memory steers ONE agent
// on ONE machine; a guard, lint rule, or check steers every agent in the
// fleet. When the memory being saved encodes a rule, correction, or
// convention, the write moment is the cheapest time to also codify it — the
// context is loaded and the lesson is fresh.
//
// Division of labor across the memory-codification surfaces:
//   - THIS hook: immediate, unconditional on a memory-store write — the
//     reminder lands in the same turn as the save.
//   - uncodified-lesson-nudge (Stop): shape-gated — re-raises at turn end when
//     the written lesson is enforceable AND cites no enforcer, with
//     cross-session escalation via the learning ledger.
//   - scripts/fleet/check/memories-are-codified.mts: the audit over the whole
//     store.
//
// PostToolUse, notify only — never blocks, always exits 0. No bypass phrase.

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// A Claude memory-store file, separator-normalized:
//   …/.claude/projects/<slug>/memory/<file>.md   (per-cwd store)
//   …/memory/MEMORY.md                           (a store's index)
const MEMORY_STORE_RE =
  /\/\.claude\/projects\/[^/]+\/memory\/[^/]+\.md$|\/memory\/MEMORY\.md$/

export function isMemoryStorePath(filePath: string): boolean {
  return MEMORY_STORE_RE.test(filePath.replaceAll('\\', '/'))
}

// The reminder, pure so the tests pin it directly.
export function buildMemoryCodifyNudge(filePath: string): string {
  const short = filePath.replace(/^.*\/memory\//, 'memory/')
  return [
    `[memory-codify-nudge] Memory saved (${short}). A memory steers ONE agent; a guard steers them all.`,
    '  If this memory encodes a rule, correction, or convention, ALSO codify it as an enforceable artifact:',
    '  a hook guard/nudge, a socket/* lint rule, a scripts/fleet/check/* check, or a docs/agents.md rule —',
    '  then stamp the memory with an `enforcement:` line. Run `/codifying-disciplines`, or for a single rule',
    '  `node scripts/fleet/codify-rule.mts --memory <path> --apply`. Reference/user memories need no enforcer.',
  ].join('\n')
}

export const check = editGuard(filePath => {
  if (!isMemoryStorePath(filePath)) {
    return undefined
  }
  return notify(buildMemoryCodifyNudge(filePath))
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
