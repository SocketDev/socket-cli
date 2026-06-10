#!/usr/bin/env node
// Claude Code Stop hook — unpushed-main-reminder.
//
// Fires at turn-end. When the current checkout is ON the default branch
// (main / master) and local HEAD is AHEAD of its origin counterpart, it
// nags to push.
//
// Why: a commit fast-forwarded to local `main` but left unpushed is
// fragile. A parallel Claude session running `git reset --hard
// origin/main` (cascade / repair flows do this) discards every local-only
// commit ahead of origin — the work silently vanishes. "Landing" a commit
// means it reached ORIGIN, not just local main. This reminder makes the
// at-risk gap visible at the turn that created it, so the push happens
// before the next reset.
//
// Only fires on the default branch: an unpushed feature branch is normal
// (you push it when ready); an unpushed DEFAULT branch ahead of origin is
// the reset-wipe hazard.
//
// Exit codes: 0 — always (informational Stop hook). Fails open.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import process from 'node:process'

export async function drainStdin(): Promise<void> {
  await new Promise<void>(resolve => {
    process.stdin.on('data', () => {})
    process.stdin.on('end', () => resolve())
    process.stdin.on('error', () => resolve())
    setTimeout(() => resolve(), 200)
  })
}

export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || process.cwd()
}

// Run a git command in repoDir, returning trimmed stdout or undefined.
export function git(repoDir: string, args: readonly string[]): string | undefined {
  const r = spawnSync('git', args as string[], { cwd: repoDir, timeout: 5_000 })
  if (r.error || r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  return r.stdout.trim()
}

// The current branch, or undefined when detached / not a repo.
export function currentBranch(repoDir: string): string | undefined {
  return git(repoDir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
}

// True when `branch` is the repo's default branch. Resolves origin/HEAD,
// falls back main → master (the fleet default-branch order). Never
// hard-codes a single name.
export function isDefaultBranch(repoDir: string, branch: string): boolean {
  const head = git(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (head) {
    const name = head.replace(/^refs\/remotes\/origin\//, '')
    if (name) {
      return branch === name
    }
  }
  return branch === 'main' || branch === 'master'
}

// Count of local commits ahead of origin/<branch>, or 0 when no upstream.
export function commitsAhead(repoDir: string, branch: string): number {
  const out = git(repoDir, [
    'rev-list',
    '--count',
    `origin/${branch}..HEAD`,
  ])
  if (out === undefined) {
    return 0
  }
  const n = Number.parseInt(out, 10)
  return Number.isFinite(n) ? n : 0
}

async function main(): Promise<void> {
  await drainStdin()
  const repoDir = getProjectDir()
  const branch = currentBranch(repoDir)
  if (!branch || !isDefaultBranch(repoDir, branch)) {
    return
  }
  const ahead = commitsAhead(repoDir, branch)
  if (ahead < 1) {
    return
  }
  process.stderr.write(
    [
      `[unpushed-main-reminder] ${branch} is ${ahead} commit(s) ahead of origin/${branch} — UNPUSHED.`,
      '',
      'A local fast-forward is NOT landed. A parallel session that resets',
      `${branch} to origin/${branch} (cascade / repair flows do this) will wipe`,
      'these commits. Push now so the work survives:',
      `    git push origin ${branch}`,
      '',
    ].join('\n'),
  )
}

main().catch(e => {
  // Fail open: a reminder bug must not disrupt the turn.
  process.stderr.write(
    `unpushed-main-reminder: hook error (continuing): ${(e as Error).message}\n`,
  )
})
