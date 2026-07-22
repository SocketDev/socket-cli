#!/usr/bin/env node
// Claude Code PreToolUse hook — operate-from-repo-root-guard.
//
// Blocks `cd <subpackage> && pnpm …` (and npm/yarn) Bash commands and
// steers to running from the repo root with `pnpm --filter <pkg> …`.
//
// Why: in a pnpm workspace, `cd packages/foo && pnpm test` runs against
// foo's local resolution and can miss workspace-root config, hoisted
// bins, and the lockfile's view of the graph; it also leaves the Bash
// cwd parked in the subpackage for every later command. The canonical
// way to target one project is `pnpm --filter <pkg> <script>` from the
// root — deterministic, no cwd drift.
//
// Deliberately NARROW to avoid fighting legitimate `cd`:
//   - Only fires when a `cd <target>` segment is IMMEDIATELY followed by
//     a `pnpm` / `npm` / `yarn` segment in the same command line.
//   - Skips when the target is a worktree (`…worktree…`), an absolute
//     path, `/tmp`, `-` (cd back), `~`, `$VAR`, or `..`-escapes (leaving
//     the repo). Those aren't "cd into a subpackage to run pnpm".
// Cwd drift from a bare `cd` (without a chained pm) is the
// avoid-cd-nudge's concern, not this guard's.
//
// Bypass: `Allow repo-root bypass`. Fail-open on hook bugs.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { parseCommands } from '../_shared/shell-command.mts'

// Pre-flight gate: the guard can only block a `cd <subpackage> && <pm> …`
// chain, which requires a package-manager binary segment — so the literal pm
// name must appear in the command. `npm` is a substring of `pnpm`, so these
// two cover all of {pnpm, npm, yarn}. Absent both, `check` can never block.
export const triggers: readonly string[] = ['npm', 'yarn']

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn'])

// A `cd` target that is NOT "into a subpackage of this repo": absolute
// paths, home, previous-dir, variables, /tmp, and anything mentioning a
// worktree are all left alone.
export function isSubpackageCdTarget(target: string | undefined): boolean {
  if (!target) {
    return false
  }
  // Strip a leading or trailing single/double quote that the shell may wrap around the path.
  const t = target.replace(/^['"]|['"]$/g, '')
  if (t === '' || t === '-' || t === '..') {
    return false
  }
  if (t.startsWith('/') || t.startsWith('~') || t.startsWith('$')) {
    return false
  }
  if (t.includes('worktree')) {
    return false
  }
  // A relative path that climbs out of the repo (`../sibling`) isn't a
  // subpackage of THIS repo — that's the cross-repo-guard's concern.
  if (t.startsWith('../')) {
    return false
  }
  return true
}

// True when the command line has a `cd <subpackage>` segment immediately
// followed by a package-manager segment. Returns the offending target +
// the pm for the message, or undefined.
export function findCdThenPm(
  command: string,
): { target: string; pm: string } | undefined {
  const cmds = parseCommands(command)
  for (let i = 0; i < cmds.length - 1; i += 1) {
    const seg = cmds[i]!
    if (seg.binary !== 'cd') {
      continue
    }
    const target = seg.args[0]
    if (!isSubpackageCdTarget(target)) {
      continue
    }
    const next = cmds[i + 1]!
    if (PACKAGE_MANAGERS.has(next.binary)) {
      // Strip surrounding quotes from the target before returning, same as above.
      return { target: target!.replace(/^['"]|['"]$/g, ''), pm: next.binary }
    }
  }
  return undefined
}

export const check = bashGuard(command => {
  const hit = findCdThenPm(command)
  if (!hit) {
    return undefined
  }
  return block(
    [
      '[operate-from-repo-root-guard] Blocked: `cd ' +
        hit.target +
        ' && ' +
        hit.pm +
        ' …`',
      '',
      '  Run pnpm from the repo root, not a subpackage. To target one',
      '  workspace project:',
      `    pnpm --filter <pkg> <script>`,
      '',
      `  (\`cd ${hit.target}\` parks the Bash cwd there for later commands`,
      "  and runs against the subpackage's local resolution, not the",
      '  workspace root.)',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['repo-root'],
  bypassOptional: true,
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
