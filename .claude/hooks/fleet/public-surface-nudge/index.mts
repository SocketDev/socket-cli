#!/usr/bin/env node
// Claude Code PreToolUse hook — public-surface reminder.
//
// Never blocks. On every Bash command that would publish text to a public
// Git/GitHub surface (git commit, git push, gh pr/issue/api/release write),
// writes a short reminder to stderr so the model re-reads the command with
// the two rules freshly in mind:
//
//   1. No real customer/company names — ever. Use `Acme Inc` instead.
//   2. No internal work-item IDs or tracker URLs — no `SOC-123`, `ENG-456`,
//      `ASK-789`, `linear.app`, `sentry.io`, etc.
//
// Exit code is always 0. This is attention priming, not enforcement. The
// model is responsible for actually applying the rule — the hook just makes
// sure the rule is in the active context at the moment the command is about
// to fire.
//
// Deliberately carries no list of customer names. Recognition and
// replacement happen at write time, not via enumeration.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { isPublicSurface } from '../_shared/public-surfaces.mts'

// Pre-flight skip keys. Every PUBLIC_SURFACE_PATTERN begins with `\bgit\s+`
// or `\bgh\s+`, so isPublicSurface can only fire when the command names one
// of these two binaries. A payload with neither substring can never notify.
export const triggers: readonly string[] = ['gh', 'git']

export const check = bashGuard(command => {
  if (!isPublicSurface(command)) {
    return undefined
  }
  const lines = [
    '[public-surface-nudge] This command writes to a public Git/GitHub surface.',
    '  • Re-read the commit message / PR body / comment BEFORE it sends.',
    '  • No real customer or company names — use `Acme Inc`. No exceptions.',
    '  • No internal work-item IDs or tracker URLs (linear.app, sentry.io, SOC-/ENG-/ASK-/etc.).',
    '  • If you spot one, cancel and rewrite the text first.',
  ]
  return notify(lines.join('\n'))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'nudge',
})
void runHook(hook, import.meta.url)
