#!/usr/bin/env node
// Claude Code PreToolUse hook — no-branch-reuse-guard.
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

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { withBashGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { commandsFor } from '../_shared/shell-command.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow branch-reuse bypass'

export function isGitCommit(command: string): boolean {
  return commandsFor(command, 'git').some(
    c => c.args.includes('commit') && !c.args.includes('--amend'),
  )
}

export function currentBranch(cwd: string): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    timeout: 5_000,
  })
  if (r.status !== 0) {
    return undefined
  }
  return String(r.stdout).trim()
}

export function resolveDefaultBranch(cwd: string): string {
  const r = spawnSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
    cwd,
    timeout: 5_000,
  })
  if (r.status === 0) {
    const ref = String(r.stdout)
      .trim()
      .replace(/^refs\/remotes\/origin\//, '')
    if (ref) {
      return ref
    }
  }
  return 'main'
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
    { cwd, timeout: 5_000 },
  )
  if (upstreamRef.status !== 0) {
    return false
  }
  // Does the upstream have at least one commit?
  const upstream = String(upstreamRef.stdout).trim()
  const revParse = spawnSync('git', ['rev-parse', '--verify', upstream], {
    cwd,
    timeout: 5_000,
  })
  return revParse.status === 0
}

if (process.argv[1]?.endsWith('index.mts')) {
  await withBashGuard((command, payload) => {
    if (!isGitCommit(command)) {
      return
    }
    const cwd = payload.cwd ?? process.cwd()
    const branch = currentBranch(cwd)
    if (!branch) {
      return
    }
    const defaultBranch = resolveDefaultBranch(cwd)
    // Committing on the default branch is fine — direct-push-to-main.
    if (branch === defaultBranch) {
      return
    }
    // A branch with no remote history was cut fresh this session — fine.
    if (!hasExistingRemoteHistory(cwd, branch)) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      logger.error(
        `no-branch-reuse-guard: committing onto existing remote branch "${branch}" — bypassed via "${BYPASS_PHRASE}"\n`,
      )
      return
    }
    logger.error(
      [
        `no-branch-reuse-guard: committing onto an existing remote branch`,
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
        `  Bypass: type "${BYPASS_PHRASE}" to proceed anyway.`,
        ``,
        `  Reminder-only; not a block.`,
        ``,
      ].join('\n'),
    )
  })
}
