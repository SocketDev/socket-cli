#!/usr/bin/env node
// Claude Code Stop hook — dirty-worktree-on-stop-reminder.
//
// Fires at turn-end. Checks `git status --porcelain` in the harness
// project dir. If anything is modified, untracked, or staged but
// uncommitted, emits a stderr reminder listing the dirty paths.
//
// The fleet rule (CLAUDE.md "Don't leave the worktree dirty"):
//
//   Finish a code change → commit it. Never end a turn with
//   uncommitted edits, untracked files, or staged-but-uncommitted
//   hunks. If you can't commit yet (mid-refactor, failing tests,
//   waiting on user), announce it in the turn summary — silent
//   dirty worktrees are the failure mode.
//
// Why a reminder, not a block: Stop hooks fire AFTER the turn ended;
// there's no tool call to refuse. The reminder makes dirty state
// visible at the very turn that created it, so the agent can resolve
// it (commit / revert / explicitly announce) before the next turn.
//
// Complements `no-orphaned-staging` which only catches index entries.
// This hook catches the broader dirty-worktree case: unstaged
// modifications and untracked files.
//
// Untracked-by-default directories (vendor/, third_party/, upstream/,
// additions/source-patched/) are filtered out — they're under
// .gitignore rules and not the failure mode this hook targets.
//
// Exit codes:
//   0 — always. Informational; never blocks.
//
// Disabled via `SOCKET_DIRTY_WORKTREE_REMINDER_DISABLED=1`.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

export async function drainStdin(): Promise<void> {
  await new Promise<void>(resolve => {
    let chunks = ''
    process.stdin.on('data', d => {
      chunks += d.toString('utf8')
    })
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    setTimeout(() => resolve(), 200)
    void chunks
  })
}

export function getProjectDir(): string | undefined {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

interface DirtyEntry {
  readonly status: string
  readonly path: string
}

// Untracked-by-default path prefixes — match the CLAUDE.md
// "Untracked-by-default for vendored / build-copied trees" list.
const UNTRACKED_BY_DEFAULT_PREFIXES = [
  'additions/source-patched/',
  'vendor/',
  'third_party/',
  'external/',
  'upstream/',
  'deps/',
  'pkg-node/',
]

export function isUntrackedByDefault(p: string): boolean {
  for (const prefix of UNTRACKED_BY_DEFAULT_PREFIXES) {
    if (p.startsWith(prefix)) {
      return true
    }
  }
  if (/(^|\/)[^/]+-(?:bundled|vendored)(\/|$)/.test(p)) {
    return true
  }
  return false
}

export function parsePorcelain(out: string): DirtyEntry[] {
  const entries: DirtyEntry[] = []
  for (const line of out.split('\n')) {
    if (!line) {
      continue
    }
    const status = line.slice(0, 2)
    const rest = line.slice(3)
    const arrow = rest.indexOf(' -> ')
    const filePath = arrow === -1 ? rest : rest.slice(arrow + 4)
    if (isUntrackedByDefault(filePath)) {
      continue
    }
    entries.push({ status, path: filePath })
  }
  return entries
}

export function listDirtyEntries(repoDir: string): DirtyEntry[] {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoDir,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return []
  }
  return parsePorcelain(String(r.stdout))
}

async function main(): Promise<void> {
  if (process.env['SOCKET_DIRTY_WORKTREE_REMINDER_DISABLED']) {
    return
  }
  await drainStdin()

  const repoDir = getProjectDir()
  if (!repoDir) {
    return
  }

  const dirty = listDirtyEntries(repoDir)
  if (dirty.length === 0) {
    return
  }

  process.stderr.write(
    `[dirty-worktree-on-stop-reminder] Turn ended with ${dirty.length} dirty path(s):\n`,
  )
  for (const e of dirty.slice(0, 10)) {
    process.stderr.write(`  ${e.status} ${e.path}\n`)
  }
  if (dirty.length > 10) {
    process.stderr.write(`  ... and ${dirty.length - 10} more\n`)
  }
  process.stderr.write(
    "\nFleet rule: end-of-turn worktree must match the user's mental\n" +
      "model of where the work is. 'Done' means committed. Options:\n" +
      '  • Commit the dirty paths (surgical: explicit file args).\n' +
      '  • Revert paths you did not author this session.\n' +
      '  • If pause is intentional (mid-refactor, waiting on user),\n' +
      '    announce it explicitly in the turn summary.\n' +
      '\nSilent dirty worktrees break the next session. See:\n' +
      '  CLAUDE.md → "Don\'t leave the worktree dirty"\n' +
      '  docs/claude.md/fleet/worktree-hygiene.md\n',
  )
}

main().catch(e => {
  process.stderr.write(
    `[dirty-worktree-on-stop-reminder] hook bug — fail-open. ${e instanceof Error ? e.message : String(e)}\n`,
  )
})
