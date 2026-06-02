import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function g(cwd: string, args: string[]): void {
  spawnSync('git', args, { cwd })
}

interface Repo {
  readonly primary: string
  readonly worktree: string
  cleanup(): void
}

// A primary checkout with an `origin/main` remote-tracking ref + a linked
// worktree branched off it. Returns both paths.
function makeRepoWithWorktree(): Repo {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cadence-'))
  const remote = path.join(root, 'remote.git')
  const primary = path.join(root, 'primary')
  const worktree = path.join(root, 'wt')

  spawnSync('git', ['init', '--bare', '-b', 'main', remote])
  spawnSync('git', ['clone', remote, primary])
  for (const [k, v] of [
    ['user.email', 't@e.com'],
    ['user.name', 'tester'],
    ['commit.gpgsign', 'false'],
  ]) {
    g(primary, ['config', k, v])
  }
  writeFileSync(path.join(primary, 'README.md'), 'hi\n')
  g(primary, ['add', 'README.md'])
  g(primary, ['commit', '-m', 'init'])
  g(primary, ['push', 'origin', 'main'])
  // Linked worktree off main.
  g(primary, ['worktree', 'add', '-b', 'feat', worktree])
  for (const [k, v] of [
    ['user.email', 't@e.com'],
    ['user.name', 'tester'],
    ['commit.gpgsign', 'false'],
  ]) {
    g(worktree, ['config', k, v])
  }

  return {
    primary,
    worktree,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function runHook(
  cwd: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    cwd,
    input: JSON.stringify({ hook_event_name: 'Stop' }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...extraEnv },
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('REMINDS to commit when the worktree has uncommitted changes', () => {
  const repo = makeRepoWithWorktree()
  try {
    writeFileSync(path.join(repo.worktree, 'work.ts'), 'export const x = 1\n')
    const { stderr, exitCode } = runHook(repo.worktree)
    assert.equal(exitCode, 0)
    assert.match(stderr, /commit-cadence-reminder/)
    assert.match(stderr, /uncommitted/)
    assert.match(stderr, /--no-verify/)
  } finally {
    repo.cleanup()
  }
})

test('REMINDS of the merge gate when the worktree branch is ahead of base', () => {
  const repo = makeRepoWithWorktree()
  try {
    writeFileSync(path.join(repo.worktree, 'work.ts'), 'export const x = 1\n')
    g(repo.worktree, ['add', 'work.ts'])
    g(repo.worktree, ['commit', '-m', 'feat: step'])
    const { stderr, exitCode } = runHook(repo.worktree)
    assert.equal(exitCode, 0)
    assert.match(stderr, /ahead of the target branch/)
    assert.match(stderr, /pnpm run fix --all/)
    assert.match(stderr, /pnpm run check --all/)
    assert.match(stderr, /pnpm run test/)
  } finally {
    repo.cleanup()
  }
})

test('QUIET in the worktree when clean + not ahead', () => {
  const repo = makeRepoWithWorktree()
  try {
    const { stderr } = runHook(repo.worktree)
    assert.doesNotMatch(stderr, /commit-cadence-reminder/)
  } finally {
    repo.cleanup()
  }
})

test('QUIET in the PRIMARY checkout even when dirty (worktree-only scope)', () => {
  const repo = makeRepoWithWorktree()
  try {
    writeFileSync(path.join(repo.primary, 'work.ts'), 'export const x = 1\n')
    const { stderr } = runHook(repo.primary)
    assert.doesNotMatch(stderr, /commit-cadence-reminder/)
  } finally {
    repo.cleanup()
  }
})

test('disabled env var short-circuits', () => {
  const repo = makeRepoWithWorktree()
  try {
    writeFileSync(path.join(repo.worktree, 'work.ts'), 'export const x = 1\n')
    const { stderr } = runHook(repo.worktree, {
      SOCKET_COMMIT_CADENCE_REMINDER_DISABLED: '1',
    })
    assert.doesNotMatch(stderr, /commit-cadence-reminder/)
  } finally {
    repo.cleanup()
  }
})

test('never blocks (exit 0) even when reminding', () => {
  const repo = makeRepoWithWorktree()
  try {
    writeFileSync(path.join(repo.worktree, 'work.ts'), 'export const x = 1\n')
    const { exitCode } = runHook(repo.worktree)
    assert.equal(exitCode, 0)
  } finally {
    repo.cleanup()
  }
})
