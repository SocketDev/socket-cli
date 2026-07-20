#!/usr/bin/env node
// Claude Code PreToolUse hook — no-branch-reuse-nudge.
//
// renamed-from: no-branch-reuse-guard
//
// Reminder (NOT a block) on `git commit` when the current branch is NOT
// the default branch (main/master) AND the branch already has an upstream
// tracking ref on the remote — meaning the agent is committing onto an
// existing shared branch rather than cutting a fresh one per logical
// change.
//
// Per CLAUDE.md "Smallest chunks / branch discipline": cut a FRESH branch
// per logical change, never reuse or commit onto an existing branch that
// belongs to a different logical unit of work.
//
// Why this matters: reusing a branch merges unrelated commits into a
// single PR / push, complicates code review, and causes rebase pain when
// the branch is already on the remote. The incident that prompted this
// rule: 2026-06-02 a session cut `feat/spawn-kill-tree` on socket-lib
// (assuming PR workflow), then had to create a PR to land the work — the
// correct move was `git push origin feat/spawn-kill-tree:main` directly,
// which would have been obvious if the branch hadn't been created at all.
//
// Allowed (passes through):
//   - Committing on main/master (direct-push-to-main is the fleet default).
//   - A branch with NO remote upstream (freshly cut this session).
//   - Bypass: `Allow branch-reuse bypass` in a recent turn.
//
// Fires as a PreToolUse Bash hook; exits 0 always (reminder-only).

import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { currentBranch, resolveDefaultBranch } from '../_shared/git-branch.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { gitCommitSegments } from '../_shared/commit-command.mts'

// Amend excluded on purpose: amending the tip is not branch reuse. The
// segment parse is the shared one — a positional arg that merely CONTAINS
// the word commit (a path, `git log commit`) never matches.
export function isGitCommit(command: string): boolean {
  return gitCommitSegments(command).some(c => !c.args.includes('--amend'))
}

// True when the branch has a remote upstream tracking ref AND that
// upstream already has commits (i.e. the branch was pushed to the remote
// before this session started). A branch with no upstream is freshly cut
// this session — leave it alone.
export function hasExistingRemoteHistory(cwd: string, branch: string): boolean {
  // Does the branch have an upstream configured?
  const upstreamRef = spawnSync(
    'git',
    ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`],
    { cwd, timeout: spawnTimeoutMs(5000) },
  )
  if (upstreamRef.status !== 0) {
    return false
  }
  // Does the upstream have at least one commit?
  const upstream = String(upstreamRef.stdout).trim()
  const revParse = spawnSync('git', ['rev-parse', '--verify', upstream], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  return revParse.status === 0
}

export const check = bashGuard((command, payload) => {
  if (!isGitCommit(command)) {
    return undefined
  }
  const cwd = payload.cwd ?? process.cwd()
  const branch = currentBranch(cwd)
  if (!branch) {
    return undefined
  }
  const defaultBranch = resolveDefaultBranch(cwd)
  // Committing on the default branch is fine — direct-push-to-main.
  if (branch === defaultBranch) {
    return undefined
  }
  // A branch with no remote history was cut fresh this session — fine.
  if (!hasExistingRemoteHistory(cwd, branch)) {
    return undefined
  }
  return notify(
    [
      `no-branch-reuse-nudge: committing onto an existing remote branch`,
      ``,
      `  Branch: ${branch}  (already has history on origin)`,
      ``,
      `  Per CLAUDE.md "branch discipline" — cut a FRESH branch per logical`,
      `  change; never reuse an existing branch for unrelated work. Reusing`,
      `  mixes commits into one PR, complicates review, and causes rebase pain.`,
      ``,
      `  If this is the right branch for this change, push straight to main:`,
      ``,
      `    git push origin ${branch}:${defaultBranch}`,
      ``,
      `  If you need a new branch: git checkout -b <fresh-name>`,
      ``,
      `  Reminder-only; not a block.`,
      ``,
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['branch-reuse'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})

void runHook(hook, import.meta.url)
