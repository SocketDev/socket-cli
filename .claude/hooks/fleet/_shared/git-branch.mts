// Shared git branch resolution for hooks. ~9 hooks independently re-derived
// the current branch + the repo's default branch (origin/HEAD → main → master,
// the fleet order from CLAUDE.md "Default branch fallback"); one of them
// (no-branch-reuse-nudge) only fell back to `main`, never `master` — a
// correctness gap on master-default repos. Single source so the fallback order
// can't drift.

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

// Run a git command in `repoDir`, returning trimmed stdout, or undefined on a
// non-zero exit / spawn error / missing repo.
export function gitOut(
  repoDir: string,
  args: readonly string[],
): string | undefined {
  const r = spawnSync('git', [...args], { cwd: repoDir, timeout: 5000 })
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  return r.stdout.trim()
}

// The current branch, or undefined when detached / not a repo.
export function currentBranch(repoDir: string): string | undefined {
  return gitOut(repoDir, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
}

// Resolve the repo's default branch: prefer `origin/HEAD`, else probe
// `origin/main` then `origin/master` (the fleet order — main→master matches
// fleet reality, reversing would mispick during rename migrations). Falls back
// to `main` when neither remote ref exists yet.
export function resolveDefaultBranch(repoDir: string): string {
  const head = gitOut(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (head) {
    const name = head.replace(/^refs\/remotes\/origin\//, '')
    if (name) {
      return name
    }
  }
  if (
    gitOut(repoDir, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/remotes/origin/main',
    ]) !== undefined
  ) {
    return 'main'
  }
  if (
    gitOut(repoDir, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/remotes/origin/master',
    ]) !== undefined
  ) {
    return 'master'
  }
  return 'main'
}

// True when `branch` is the repo's default branch.
export function isDefaultBranch(repoDir: string, branch: string): boolean {
  return branch === resolveDefaultBranch(repoDir)
}
