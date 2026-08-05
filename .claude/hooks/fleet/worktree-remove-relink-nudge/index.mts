#!/usr/bin/env node
// Claude Code PostToolUse hook — worktree-remove-relink-nudge.
//
// After a Bash `git worktree remove` / `git worktree prune`, nudge the
// agent to run `pnpm i` in the MAIN checkout. Why: creating a worktree
// (and running pnpm there, or pnpm relinking the shared store while it
// exists) can leave the main repo's `node_modules` symlinks — e.g.
// `@socketsecurity/lib-stable` — pointing INTO the worktree dir. Removing
// the worktree then dangles those links, and every lib-importing fleet
// hook dies with `ERR_MODULE_NOT_FOUND: Cannot find package
// '@socketsecurity/lib-stable'`. `pnpm install` rebuilds the links from
// the lockfile.
//
// Detects:
//   1. Bash tool calls
//   2. Containing `git worktree remove` or `git worktree prune`
//      (via the shared shell parser — sees through chains / `git -C`,
//      ignores a quoted command in a message)
//
// Reminder only: writes to stderr, exits 0, never blocks. The push/
// removal already happened; this adds the relink step for the next turn.
//
// Fail-open on any hook bug: exit 0 so a parser glitch can't wedge the
// session.

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// True when `command` removes or prunes a git worktree. `add`/`list`/`move`
// don't orphan the main checkout's links, so they don't fire. Scans the
// parsed `git` segments' args for `worktree` followed by `remove`/`prune` —
// robust to `git -C <path> worktree remove …` and chained commands.
export function isWorktreeRemoveOrPrune(command: string): boolean {
  for (const cmd of commandsFor(command, 'git')) {
    const args = cmd.args.filter(a => !a.startsWith('-'))
    const wtIdx = args.indexOf('worktree')
    if (wtIdx === -1) {
      continue
    }
    const verb = args[wtIdx + 1]
    if (verb === 'prune' || verb === 'remove') {
      return true
    }
  }
  return false
}

export function formatReminder(): string {
  return (
    '🔗 worktree-remove-relink-nudge: worktree removed/pruned — run `pnpm i` ' +
    'in the MAIN checkout to relink node_modules before hooks die with ' +
    'ERR_MODULE_NOT_FOUND (no-TTY purge prompt: `CI=true pnpm i`).'
  )
}

export const check = bashGuard((command, _payload) => {
  if (!isWorktreeRemoveOrPrune(command)) {
    return undefined
  }
  return notify(formatReminder())
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
