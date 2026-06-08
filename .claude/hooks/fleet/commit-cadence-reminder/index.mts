#!/usr/bin/env node
// Claude Code Stop hook — commit-cadence-reminder.
//
// Fires at turn-end. Reinforces the CLAUDE.md "Small commits as you go; gate
// the merge" rule in the worktree workflow:
//
//   1. Inside a `git worktree`, commit each logical step as it lands — the
//      worktree is scratch space, so `--no-verify` is fine there (the heavy
//      gate runs once before merge, not on every commit). If the worktree has
//      uncommitted edits at turn-end, remind to commit the step.
//   2. Before landing the worktree branch into the target branch, the merge
//      gate must pass clean: `pnpm run fix --all`, `pnpm run check --all`,
//      `pnpm run test`. When the branch is ahead of its merge base, surface the
//      gate so it isn't merged red.
//
// Reminder, not a block: a Stop hook fires AFTER the turn; there's no tool call
// to refuse. The reminder makes cadence + the pre-merge gate visible at the
// turn that created the state.
//
// Scope: only nudges inside a worktree (the workflow this rule targets). In the
// primary checkout, dirty-worktree-stop-reminder + commit-pr-reminder cover
// the dirty/landing cases; this hook stays quiet there to avoid double-nagging.
//
//
// Exit codes: 0 always — informational, never blocks.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

function drainStdin(): Promise<void> {
  return new Promise<void>(resolve => {
    process.stdin.on('data', () => {})
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    setTimeout(() => resolve(), 200)
  })
}

function git(repoDir: string, args: string[]): string | undefined {
  const r = spawnSync('git', args, { cwd: repoDir, timeout: 5_000 })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout).trim()
}

// A linked worktree has a distinct working-tree git dir from the common dir;
// the primary checkout has them equal. Returns true only for linked worktrees.
function isLinkedWorktree(repoDir: string): boolean {
  const gitDir = git(repoDir, ['rev-parse', '--git-dir'])
  const commonDir = git(repoDir, ['rev-parse', '--git-common-dir'])
  if (!gitDir || !commonDir) {
    return false
  }
  return gitDir !== commonDir
}

// Count of tracked/untracked changes (porcelain lines). Vendored / untracked-
// by-default trees aren't the cadence target, but a coarse count is enough for
// a reminder — the dirty-worktree hook handles the precise path listing.
function uncommittedCount(repoDir: string): number {
  const out = git(repoDir, ['status', '--porcelain'])
  if (!out) {
    return 0
  }
  return out.split('\n').filter(Boolean).length
}

// Commits on HEAD not yet on the merge base with the default branch — i.e. work
// staged to land. Resolves the base via origin/HEAD, falling back main → master
// per the fleet default-branch rule.
function commitsAheadOfBase(repoDir: string): number {
  let base = git(repoDir, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
  ])?.replace(/^refs\/remotes\/origin\//, '')
  if (!base) {
    if (
      git(repoDir, [
        'show-ref',
        '--verify',
        '--quiet',
        'refs/remotes/origin/main',
      ]) !== undefined
    ) {
      base = 'main'
    } else if (
      git(repoDir, [
        'show-ref',
        '--verify',
        '--quiet',
        'refs/remotes/origin/master',
      ]) !== undefined
    ) {
      base = 'master'
    } else {
      base = 'main'
    }
  }
  const count = git(repoDir, ['rev-list', '--count', `origin/${base}..HEAD`])
  const n = Number(count)
  return Number.isFinite(n) ? n : 0
}

async function main(): Promise<void> {
  await drainStdin()

  const repoDir = process.env['CLAUDE_PROJECT_DIR'] || process.cwd()

  // Only nudge in a linked worktree — the workflow this rule targets.
  if (!isLinkedWorktree(repoDir)) {
    return
  }

  const dirty = uncommittedCount(repoDir)
  const ahead = commitsAheadOfBase(repoDir)
  if (dirty === 0 && ahead === 0) {
    return
  }

  const lines = ['[commit-cadence-reminder] Worktree cadence check.', '']
  if (dirty > 0) {
    lines.push(
      `  ${dirty} uncommitted change(s). Commit this logical step now —`,
      '  small commits as you go. In a worktree `--no-verify` is fine.',
    )
  }
  if (ahead > 0) {
    lines.push(
      `  ${ahead} commit(s) ahead of the target branch. Before merging,`,
      '  the gate must pass clean:',
      '    pnpm run fix --all',
      '    pnpm run check --all',
      '    pnpm run test',
    )
  }
  logger.error(lines.join('\n') + '\n')
}

void main()
