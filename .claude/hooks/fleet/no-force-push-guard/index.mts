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

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { pushDestinations } from '../_shared/push-refspec.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger: every git-push command (force or not) carries the
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
 */
export function matchForcePush(command: string): ForcePushMatch | undefined {
  for (const c of commandsFor(command, 'git')) {
    if (!c.args.includes('push')) {
      continue
    }
    const lease = c.args.find(a => a.startsWith('--force-with-lease'))
    if (lease) {
      return {
        bare: lease === '--force-with-lease',
        matchedSubstring: 'git push --force-with-lease',
      }
    }
    if (c.args.includes('--force')) {
      return { bare: true, matchedSubstring: 'git push --force' }
    }
    if (c.args.includes('-f')) {
      return { bare: true, matchedSubstring: 'git push -f' }
    }
    if (c.args.includes('--force-if-includes')) {
      return { bare: true, matchedSubstring: 'git push --force-if-includes' }
    }
  }
  return undefined
}

export function blockMessage(command: string, match: ForcePushMatch): string {
  const lines: string[] = []
  lines.push('[no-force-push-guard] Blocked: git push carries a force flag.')
  lines.push(`  Match:   ${match.matchedSubstring}`)
  lines.push(`  Command: ${command}`)
  lines.push('')
  if (match.bare) {
    lines.push(
      '  Saw a force push with no lease pinned to an expected remote sha —',
    )
    lines.push(
      '  it can silently clobber commits someone else pushed since your',
    )
    lines.push('  last fetch.')
  } else {
    lines.push(
      '  Saw a force push already pinning --force-with-lease to an expected',
    )
    lines.push(
      '  sha, the right instinct. It still needs the same authorization as',
    )
    lines.push('  a bare force.')
  }
  lines.push('')
  lines.push('  Fleet default (refuses if the remote moved since fetch):')
  lines.push(
    '    git fetch origin && git push --force-with-lease=<branch>:$(git rev-parse origin/<branch>) origin <branch>',
  )
  lines.push('')
  lines.push(
    '  To proceed, the user must type the EXACT phrase in a new message:',
  )
  lines.push(`    ${BYPASS_PHRASE}`)
  lines.push('')
  lines.push(
    '  (Legacy aliases also accepted: "Allow force-with-lease bypass",',
  )
  lines.push('  "Allow force-push-hard bypass" — one phrase covers both')
  lines.push('  the bare form and the lease form.)')
  lines.push('')
  lines.push(
    '  The phrase is case-insensitive but every word must appear, in order.',
  )
  lines.push(
    '  Inferring intent from a paraphrase ("go ahead", "force it") does NOT',
  )
  lines.push('  count.')
  return lines.join('\n')
}

/**
 * Branch-scoped combo phrases for this command's push destinations.
 * `Allow force-with-lease <branch> bypass` authorizes BOTH the force flag
 * (this guard) and the protected-branch push (`push-protected-branch-guard`)
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
  // squash (byte-verified tree, backup branch already pushed) — see
  // `_shared/squash-sentinel.mts` for the hardened shape this honors.
  if (squashSentinelAllows(command)) {
    return undefined
  }

  const matched = matchForcePush(command)
  if (!matched) {
    return undefined
  }

  const phrases = [...ACCEPTED_PHRASES, ...scopedLeasePhrases(command)]
  if (bypassPhrasePresent(payload.transcript_path, phrases)) {
    return undefined
  }

  return block(blockMessage(command, matched))
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
