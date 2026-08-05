#!/usr/bin/env node
// Claude Code PreToolUse hook — no-force-push-guard.
//
// Blocks a `git push` carrying any force flag (`--force`, `-f`,
// `--force-with-lease` in any spelling — bare or `=<branch>:<expected-sha>`
// — and `--force-if-includes`) unless the user has authorized it with the
// canonical phrase `Allow force-push bypass` in a recent user turn.
//
// ONE phrase covers BOTH force forms — the bare flag and the safer lease.
// There is no separate "hard" phrase: typing `Allow force-push bypass`
// unlocks whichever form the command actually uses. What differs by form is
// the BLOCK message: it always teaches the fleet's canonical shape,
//   git fetch origin && git push --force-with-lease=<branch>:$(git rev-parse origin/<branch>) origin <branch>
// so a bare `--force`/`-f`, or a bare `--force-with-lease` with no pinned
// `=<ref>:<expected>` value, gets pointed at the safer pinned-lease form.
//
// Legacy aliases (still accepted, pre-split phrases from when these checks
// lived inside no-revert-guard): `Allow force-with-lease bypass`,
// `Allow force-push-hard bypass`. New usage should reach for the canonical
// `Allow force-push bypass`.
//
// Honors the `SQUASH_HISTORY=1` sentinel (`_shared/squash-sentinel.mts`):
// the `squashing-history` skill force-pushes the collapsed default branch
// as an intrinsic part of the squash (the tree is byte-verified identical
// to a backup branch first), so that exact hardened shape passes without
// the typed phrase.
//
// Universal, not fleet-only: clobbering remote work is hazardous in any
// repo, fleet or not.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "transcript_path": "/.../session.jsonl" }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { gitSubcommandReadings } from '../_shared/git-subcommand.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { pushDestinations } from '../_shared/push-refspec.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import {
  mostRecentAssistantIsSidechain,
  operatorBypassPresent,
} from '../_shared/transcript.mts'

// Pre-flight trigger: every git-push command, force or not, carries the
// literal `push` token, so this is the necessary substring the dispatcher
// gates on before importing this guard.
export const triggers: readonly string[] = ['push']

const BYPASS_PHRASE = 'Allow force-push bypass'

// Pre-split phrases from when the force-push rules lived inside
// no-revert-guard. Accepted so existing docs/habits keep working.
const LEGACY_BYPASS_PHRASES = [
  'Allow force-with-lease bypass',
  'Allow force-push-hard bypass',
] as const

const ACCEPTED_PHRASES: readonly string[] = [
  BYPASS_PHRASE,
  ...LEGACY_BYPASS_PHRASES,
]

export interface ForcePushMatch {
  // True for a form missing the safest spelling — a bare `--force`/`-f`, a
  // bare `--force-with-lease` with no pinned `=<ref>:<expected>` value, or a
  // standalone `--force-if-includes`. False only when `--force-with-lease`
  // already carries its expected-ref value.
  readonly bare: boolean
  // The matched substring, for the block message.
  readonly matchedSubstring: string
}

/**
 * Detect a `git push` carrying a force flag in any of the spellings this
 * guard cares about. Sees through chains / `$(…)` substitution / quoting via
 * the shared shell parser, so a quoted "git push --force" inside a commit
 * message is not a match.
 *
 * Reads the subcommand through `gitSubcommandReadings`, the FAIL-CLOSED
 * split: a recognized global option's value is skipped (so `git -C push
 * fetch --force` is a force FETCH, not a match), while a global option the
 * table does not know widens the scan to every candidate subcommand rather
 * than letting an unknown spelling walk a force-push past the guard.
 */
export function matchForcePush(command: string): ForcePushMatch | undefined {
  for (const c of commandsFor(command, 'git')) {
    for (const { rest, sub } of gitSubcommandReadings(c.args)) {
      if (sub !== 'push') {
        continue
      }
      const lease = rest.find(a => a.startsWith('--force-with-lease'))
      if (lease) {
        return {
          bare: lease === '--force-with-lease',
          matchedSubstring: 'git push --force-with-lease',
        }
      }
      if (rest.includes('--force')) {
        return { bare: true, matchedSubstring: 'git push --force' }
      }
      if (rest.includes('-f')) {
        return { bare: true, matchedSubstring: 'git push -f' }
      }
      if (rest.includes('--force-if-includes')) {
        return { bare: true, matchedSubstring: 'git push --force-if-includes' }
      }
    }
  }
  return undefined
}

export function blockMessage(
  command: string,
  match: ForcePushMatch,
  options?: { isSubagent?: boolean | undefined } | undefined,
): string {
  const opts = { __proto__: null, ...options } as {
    isSubagent?: boolean | undefined
  }
  void command
  const saw = match.bare
    ? 'no lease pinned'
    : 'already pinning --force-with-lease, still needs authorization'
  const lines: string[] = [
    `🚨 no-force-push-guard: blocked "${match.matchedSubstring}" (${saw}) — use git fetch origin && git push --force-with-lease=<branch>:$(git rev-parse origin/<branch>) origin <branch> (bypass response "${BYPASS_PHRASE}")`,
  ]
  if (opts.isSubagent) {
    lines.push(
      '   subagent: no phrase authorizes you — end the turn naming this guard in your FINAL text; the orchestrator runs the push itself.',
    )
  }
  return lines.join('\n')
}

/**
 * Branch-scoped combo phrases for this command's push destinations.
 * `Allow force-with-lease <branch> bypass` authorizes BOTH the force flag
 * this guard, and the protected-branch push (`push-protected-branch-guard`)
 * for exactly that branch — one phrase for the one operation a squash-repo
 * reconciliation performs, and it cannot leak to a different branch later.
 */
export function scopedLeasePhrases(command: string): string[] {
  const out: string[] = []
  for (const c of commandsFor(command, 'git')) {
    const pushIdx = c.args.indexOf('push')
    if (pushIdx === -1) {
      continue
    }
    const { destinations } = pushDestinations(c.args.slice(pushIdx + 1))
    for (const destination of destinations) {
      out.push(`Allow force-with-lease ${destination} bypass`)
    }
  }
  return out
}

export const check = bashGuard((command, payload): GuardResult => {
  // Allowlist: the squashing-history skill's force-push is intrinsic to the
  // squash, byte-verified tree, backup branch already pushed — see
  // `_shared/squash-sentinel.mts` for the hardened shape this honors.
  if (squashSentinelAllows(command)) {
    return undefined
  }

  const matched = matchForcePush(command)
  if (!matched) {
    return undefined
  }

  const phrases = [...ACCEPTED_PHRASES, ...scopedLeasePhrases(command)]
  // operatorBypassPresent, not bypassPhrasePresent: a subagent never inherits
  // the operator's grant for an irreversible op, see its doc comment.
  if (operatorBypassPresent(payload.transcript_path, phrases)) {
    return undefined
  }

  return block(
    blockMessage(command, matched, {
      isSubagent: mostRecentAssistantIsSidechain(payload.transcript_path),
    }),
  )
})

export const hook = defineHook({
  bypass: ['force-push', 'force-with-lease', 'force-push-hard'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
