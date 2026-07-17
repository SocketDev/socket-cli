/*
 * @file Claude Code PreToolUse hook — attribution-rewrite-nudge.
 *
 * Hand-scripted `git rebase -i` message rewrites — a Bash command that sets
 * GIT_SEQUENCE_EDITOR and/or GIT_EDITOR around a rebase to reword commits —
 * are quoting-fragile, silently no-op when the todo regex misses its line,
 * and verify nothing afterward. All three failure modes happened live
 * (socket-mcp, 2026-07-10) while trying to strip an AI-attribution trailer.
 *
 * The deterministic owner is `scripts/fleet/strip-ai-attribution.mts`:
 * plumbing-based, rewords only flagged messages, preserves trees + author
 * identity + dates, re-signs, and verifies the final tree byte-identical.
 *
 * Fires on the combination (scripted editor env var + a `git rebase`
 * invocation) in one Bash command. Stderr reminder; never blocks — a
 * scripted-editor rebase has legitimate uses beyond message rewrites (todo
 * reordering, autosquash), so the nudge routes rather than gates. Detail:
 * docs/agents.md/fleet/history-rewrites.md
 */

import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const SCRIPTED_EDITOR_RE = /\bGIT_(?:SEQUENCE_)?EDITOR\s*=/

export function detectsScriptedRebase(command: string): boolean {
  const flat = command.replace(/\\\n/g, ' ')
  if (!SCRIPTED_EDITOR_RE.test(flat)) {
    return false
  }
  return commandsFor(flat, 'git').some(c => c.args.includes('rebase'))
}

export const hook = defineHook({
  check: bashGuard(command => {
    if (!detectsScriptedRebase(command)) {
      return undefined
    }
    return notify(
      [
        '[attribution-rewrite-nudge] scripted-editor `git rebase` detected.',
        '',
        '  A GIT_SEQUENCE_EDITOR/GIT_EDITOR rebase dance is quoting-fragile,',
        '  silently no-ops when the todo regex misses, and verifies nothing.',
        '',
        '  If the goal is removing AI attribution (or any message rewrite',
        '  across a range), the deterministic owner is:',
        '',
        '    node scripts/fleet/strip-ai-attribution.mts --base <ref> [--dry-run]',
        '',
        '  It rewords only flagged messages, preserves trees/author/dates,',
        '  re-signs, and verifies the tree byte-identical.',
        '  Detail: docs/agents.md/fleet/history-rewrites.md',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
