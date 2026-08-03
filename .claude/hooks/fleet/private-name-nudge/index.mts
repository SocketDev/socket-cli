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

  const lines = [
    '[private-name-nudge] This command writes to a public Git/GitHub surface.',
    '  • Re-read the commit message / PR body / comment BEFORE it sends.',
    '  • No private repo names. No internal project codenames. No unreleased',
    '    product names. No internal-only tooling repos absent from the public',
    '    org page. No customer/partner names.',
    '  • Omit the reference entirely. Do not substitute a placeholder — the',
    '    placeholder itself is a tell.',
    '  • If you spot one, cancel and rewrite the text first.',
  ]
  // Contributing OUTSIDE the fleet is the high-risk moment: a commit/PR/comment
  // on a third-party or public repo must not reveal that internal Socket repos
  // or tooling (e.g. the scaffolding/source-of-truth repos, build toolchain,
  // codenames) even exist. Escalate the reminder there.
  if (!isFleetTarget(payload)) {
    lines.push(
      '',
      '  ⚠ This target is OUTSIDE the fleet — a third-party / external repo.',
      '    Internal Socket repo names, internal tooling, and codenames must not',
      '    appear at all: their mere mention discloses non-public infrastructure.',
      '    Reference only what is already public on the org page.',
    )
  }
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
