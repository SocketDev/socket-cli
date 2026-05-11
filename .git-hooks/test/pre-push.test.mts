// node --test specs for .git-hooks/pre-push.mts.
//
// Smoke tests: spin up a temp git repo, commit content, feed a
// push-line to the hook over stdin, inspect exit code. Covers the
// AI-attribution block path and the secret-leak block path.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'pre-push.mts')

const ZERO_SHA = '0000000000000000000000000000000000000000'

function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-push-test-'))
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  // Create a baseline commit and an `origin/main` remote-tracking ref
  // pointing at it. The hook's range computation requires a baseline
  // — without one, it skips validation entirely (treats the push as
  // a brand-new branch with no baseline to diff against).
  writeFileSync(path.join(dir, '.gitkeep'), '')
  spawnSync('git', ['add', '.gitkeep'], { cwd: dir })
  spawnSync('git', ['commit', '-q', '-m', 'baseline', '--no-verify'], {
    cwd: dir,
  })
  // Manually create the remote-tracking ref so computeRange has a
  // baseline. spawnSync('update-ref') is a low-level git plumbing call
  // that bypasses the network.
  const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir })
    .stdout.toString()
    .trim()
  spawnSync('git', ['update-ref', 'refs/remotes/origin/main', baseSha], {
    cwd: dir,
  })
  spawnSync(
    'git',
    ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'],
    { cwd: dir },
  )
  return dir
}

function commit(
  dir: string,
  file: string,
  content: string,
  msg: string,
): string {
  writeFileSync(path.join(dir, file), content)
  spawnSync('git', ['add', file], { cwd: dir })
  spawnSync('git', ['commit', '-q', '-m', msg, '--no-verify'], { cwd: dir })
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return r.stdout.toString().trim()
}

async function runHook(
  cwd: string,
  pushLine: string,
): Promise<{ code: number; stderr: string }> {
  const child = spawn(process.execPath, [HOOK, 'origin', cwd], {
    cwd,
    stdio: 'pipe',
  })
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  child.stdin.end(pushLine)
  return new Promise(resolve => {
    child.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
}

test('pre-push: empty stdin exits 0 (nothing to push)', async () => {
  const dir = setupRepo()
  try {
    const { code } = await runHook(dir, '')
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: clean commit + clean message passes', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: initial commit',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: blocks commit with AI-attribution body', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'feat: ship feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code, stderr } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0, 'AI attribution must block push')
    assert.match(stderr, /AI attribution|Co-Authored-By/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: keeps prose mentioning Claude in context', async () => {
  // The previous regex matched bare "Claude Code" — verify the fix
  // doesn't false-positive on legitimate references.
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'foo.ts',
      'export const X = 1\n',
      'docs(claude): point at Claude Code best practices\n\nLinks the upstream guide that informs the .claude/ layout.',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.strictEqual(code, 0, 'legitimate Claude Code prose must pass')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-push: blocks commit introducing a personal-path leak', async () => {
  const dir = setupRepo()
  try {
    const sha = commit(
      dir,
      'leak.ts',
      'export const HOME = "/Users/jdalton/secret"\n',
      'feat: add config',
    )
    const pushLine = `refs/heads/main ${sha} refs/heads/main ${ZERO_SHA}\n`
    const { code } = await runHook(dir, pushLine)
    assert.notStrictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
