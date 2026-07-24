#!/usr/bin/env node
// Claude Code PreToolUse hook — no-total-squash-guard.
//
// Blocks a force push that would REPLACE a long stretch of remote history
// with a SINGLE commit. That shape is almost always a misread of
// "consolidate": consolidation means reducing history in a logical way —
// grouping related commits and squashing within groups — not collapsing
// everything since a release into one commit. A many→1 rewrite of a shared
// branch destroys the grouped history that makes bisects, reverts, and
// release notes possible.
//
// Detection: for a `git push` carrying any force flag, each destination
// branch is compared against its remote-tracking ref. If the remote side
// has ≥ MIN_REPLACED commits past the merge-base while the local side adds
// exactly one, the push is a total squash and blocks.
//
// Sanctioned paths through:
//   - The `squashing-history` skill (mirror-squash of a squashed-remote
//     repo) sets the SQUASH_HISTORY sentinel — see
//     `_shared/squash-sentinel.mts` — and passes: that flow byte-verifies
//     the tree against a backup branch first, and a single commit IS its
//     contract.
//   - The user types the exact phrase `Allow total squash bypass`.
//
// A grouped consolidation (many→several logical commits) never triggers
// this guard — only many→1 does.
//
// Fails open on git errors / detached refs / missing remote-tracking refs:
// the guard protects a specific hazardous shape, it is not a general
// force-push gate (that's no-force-push-guard's job).
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     "cwd": "/repo",
//     "transcript_path": "/.../session.jsonl" }

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import { currentBranch, gitOut } from '../_shared/git-branch.mts'
import { extractGitCwd } from '../_shared/git-cwd.mts'
import { pushDestinations, pushRemote } from '../_shared/push-refspec.mts'
import { commandsFor } from '../_shared/shell-command.mts'
import { squashSentinelAllows } from '../_shared/squash-sentinel.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// Pre-flight trigger: every git-push command carries the literal `push`
// token — the substring the dispatcher gates on before importing this guard.
export const triggers: readonly string[] = ['push']

const BYPASS_PHRASE = 'Allow total squash bypass'

// The remote must lose at least this many commits for the rewrite to count
// as a TOTAL squash. Small rewrites (amend + force, reordering a handful of
// commits) are everyday history hygiene and none of this guard's business.
const MIN_REPLACED = 10

export interface TotalSquashMatch {
  readonly added: number
  readonly branch: string
  readonly replaced: number
}

function forceFlagPresent(args: readonly string[]): boolean {
  return args.some(
    a =>
      a === '--force' ||
      a === '-f' ||
      a === '--force-if-includes' ||
      a.startsWith('--force-with-lease'),
  )
}

/**
 * Detect a force push whose outgoing side collapses ≥ MIN_REPLACED remote
 * commits into a single local commit. Sees through chains / substitution /
 * quoting via the shared shell parser. Compares against the local
 * remote-tracking ref — the same information the pushing session already
 * has; a stale tracking ref fails toward the guard's verdict matching what
 * the session believes it is rewriting.
 */
export function matchTotalSquash(
  command: string,
  hookCwd?: string | undefined,
): TotalSquashMatch | undefined {
  for (const c of commandsFor(command, 'git')) {
    const pushIdx = c.args.indexOf('push')
    if (pushIdx === -1) {
      continue
    }
    if (!forceFlagPresent(c.args)) {
      continue
    }
    const pushArgs = c.args.slice(pushIdx + 1)
    const remote = pushRemote(pushArgs) ?? 'origin'
    const repoDir = extractGitCwd(command, {
      cwd: hookCwd,
      subcommand: 'push',
    })
    const targets = pushDestinations(pushArgs)
    let destinations: readonly string[] = targets.destinations
    if (!targets.hadRefspec) {
      const current = currentBranch(repoDir)
      destinations = current ? [current] : []
    }
    for (const branch of destinations) {
      const remoteSha = gitOut(repoDir, [
        'rev-parse',
        '--verify',
        '--quiet',
        `refs/remotes/${remote}/${branch}`,
      ])
      if (!remoteSha) {
        continue
      }
      const localSha =
        gitOut(repoDir, [
          'rev-parse',
          '--verify',
          '--quiet',
          `refs/heads/${branch}`,
        ]) ?? gitOut(repoDir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
      if (!localSha) {
        continue
      }
      const base = gitOut(repoDir, ['merge-base', localSha, remoteSha])
      if (!base || base === remoteSha) {
        // Fast-forward (or unrelated histories) — not a rewrite.
        continue
      }
      const replaced = Number(
        gitOut(repoDir, ['rev-list', '--count', `${base}..${remoteSha}`]) ??
          '0',
      )
      const added = Number(
        gitOut(repoDir, ['rev-list', '--count', `${base}..${localSha}`]) ?? '0',
      )
      if (replaced >= MIN_REPLACED && added <= 1) {
        return { added, branch, replaced }
      }
    }
  }
  return undefined
}

export function blockMessage(match: TotalSquashMatch): string {
  const lines: string[] = []
  lines.push(
    '[no-total-squash-guard] Blocked: this force push collapses history to ONE commit.',
  )
  lines.push(
    `  Branch ${match.branch}: replaces ${match.replaced} remote commits with ${match.added}.`,
  )
  lines.push('')
  lines.push('  "Consolidate" means reducing history LOGICALLY — group related')
  lines.push('  commits (cascade waves, one feature, one refactor theme) and')
  lines.push('  squash within each group — not collapsing everything into a')
  lines.push('  single commit. A many-to-1 rewrite destroys the grouping that')
  lines.push('  bisects, reverts, and release notes depend on.')
  lines.push('')
  lines.push('  Do this instead:')
  lines.push('    1. Pick logical checkpoints in the original order')
  lines.push('       (git log --reverse).')
  lines.push('    2. Build one commit per group (interactive rebase, or a git')
  lines.push('       commit-tree chain over the checkpoint trees for exact')
  lines.push('       content).')
  lines.push('    3. Verify the final tree matches the old tip before pushing:')
  lines.push(
    '       test "$(git rev-parse NEW^{tree})" = "$(git rev-parse OLD^{tree})"',
  )
  lines.push('')
  lines.push('  For an intentional whole-branch mirror squash, use the')
  lines.push('  squashing-history skill (its sentinel passes this guard after')
  lines.push('  a byte-verified backup).')
  lines.push('')
  lines.push(
    '  To proceed anyway, the user must type the EXACT phrase in a new message:',
  )
  lines.push(`    ${BYPASS_PHRASE}`)
  return lines.join('\n')
}

export const check = bashGuard((command, payload): GuardResult => {
  if (squashSentinelAllows(command)) {
    return undefined
  }
  const matched = matchTotalSquash(
    command,
    (payload as { cwd?: string | undefined } | undefined)?.cwd,
  )
  if (!matched) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, [BYPASS_PHRASE])) {
    return undefined
  }
  return block(blockMessage(matched))
})

export const hook = defineHook({
  bypass: ['total-squash'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
