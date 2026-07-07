#!/usr/bin/env node
// Claude Code PostToolUse hook — post-push-ci-monitor-nudge.
//
// After a real `git push` (not a `--dry-run`), surface the rule the push
// itself does not finish: the change is not done until CI is green.
//
// Why: pushing to origin/main fans out to the whole fleet — members
// cascade from origin/main, so a red post-push CI is fleet-wide breakage,
// not a local-only failure. The agent must watch the triggered runs and
// drive them to green (fix-forward), not declare victory at the push.
//
// This hook detects:
//   1. PostToolUse Bash calls
//   2. Whose command ran a real `git push` (first arg `push`), excluding a
//      `--dry-run` / `-n` push (which triggers no CI)
//
// On match it returns a non-blocking notify reminder naming the watch
// commands (`gh run watch`, `gh run list --limit 5`). It does NOT run them
// itself — watching a CI run is a long-lived network operation, too heavy
// to fire blind from inside a fast hook; the agent runs them (the reminder
// names the exact commands). The command gate keeps it quiet: a non-push
// Bash call never triggers the reminder.
//
// PostToolUse, not PreToolUse: we react after the push has gone out and CI
// has been triggered; we don't predict it. Never blocks (notify, exit 0).

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// Pre-flight keyword: the dispatcher skips importing this hook unless the
// raw payload contains `push`.
export const triggers = ['push']

// Push flags that mean nothing actually went to the remote, so no CI was
// triggered and there is nothing to monitor. `--dry-run` / `-n` print what
// WOULD be pushed without contacting the remote.
const DRY_RUN_FLAGS = new Set(['--dry-run', '-n'])

// True when the command runs a real `git push` — a `git` segment whose
// first non-flag argument is `push`, excluding a `--dry-run` / `-n` push
// (which triggers no CI). Parsed via the shared `commandsFor` AST splitter,
// not a regex, so a chained / substituted / quoted "git push" is handled.
export function isGitPush(command: string): boolean {
  for (const cmd of commandsFor(command, 'git')) {
    const firstArg = cmd.args.find(a => !a.startsWith('-'))
    if (firstArg !== 'push') {
      continue
    }
    if (cmd.args.some(a => DRY_RUN_FLAGS.has(a))) {
      continue
    }
    return true
  }
  return false
}

export function formatReminder(): string {
  const lines: string[] = []
  lines.push('')
  lines.push('ℹ post-push-ci-monitor-nudge')
  lines.push('')
  lines.push('The push is NOT done until CI is green. Monitor the runs you')
  lines.push('just triggered and drive them to green:')
  lines.push('')
  lines.push('  gh run watch')
  lines.push('  gh run list --limit 5')
  lines.push('')
  lines.push('A red post-push CI is fleet-wide breakage — members cascade from')
  lines.push('origin/main, so a broken main breaks every repo downstream. Do')
  lines.push('not walk away from a red run: fix-forward to green.')
  lines.push('')
  lines.push(
    'The full pre-push gate (`pnpm run update`, `pnpm i`, `fix --all`,',
  )
  lines.push('`check --all`, `cover`, all tests green) should already have run')
  lines.push('before this push — if it did not, that is what just broke CI.')
  lines.push('')
  return lines.join('\n')
}

export const check = bashGuard(command =>
  isGitPush(command) ? notify(formatReminder()) : undefined,
)

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'nudge',
})
void runHook(hook, import.meta.url)
