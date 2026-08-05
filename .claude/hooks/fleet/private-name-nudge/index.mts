#!/usr/bin/env node
// Claude Code PreToolUse hook — private-name guard.
//
// renamed-from: private-name-guard
//
// Never blocks. On every Bash command that would publish text to a public
// Git/GitHub surface (git commit, git push, gh pr/issue/api/release write),
// writes a short reminder to stderr so the model re-reads the command with
// the rule freshly in mind:
//
//   No private repos or internal project names in public surfaces.
//   Omit the reference entirely — don't substitute a placeholder.
//
// Exit code is always 0. This is attention priming, not enforcement. The
// model is responsible for applying the rule — the hook just makes sure
// the rule is in the active context at the moment the command is about
// to fire.
//
// Deliberately carries no enumerated denylist. Recognition and replacement
// happen at write time, not via a list of names. A denylist is itself a
// leak — a file named `private-projects.txt` would be the very thing it
// tries to prevent.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash", "tool_input": { "command": "..." } }

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { isPublicSurface } from '../_shared/public-surfaces.mts'

export const triggers: readonly string[] = ['gh', 'git']

export const check = bashGuard((command, payload) => {
  if (!isPublicSurface(command)) {
    return undefined
  }

  // Contributing OUTSIDE the fleet is the high-risk moment: a commit/PR/comment
  // on a third-party or public repo must not reveal that internal Socket repos
  // or tooling even exist. Escalate the reminder there.
  const outside = isFleetTarget(payload)
    ? ''
    : ' ⚠ target is OUTSIDE the fleet — mention only what is already public on the org page'
  return notify(
    `ℹ private-name-nudge: this command posts to a public Git/GitHub surface — re-read it before it sends; omit private repo / internal codename / customer names entirely (no placeholders — a placeholder is itself a tell)${outside}`,
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'nudge',
})
void runHook(hook, import.meta.url)
