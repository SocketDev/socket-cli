// node --test specs for .git-hooks/pre-commit.mts.
//
// Smoke tests: spin up a temp git repo, stage a file, run the hook
// from inside it, and inspect exit code + stderr. Covers the clean
// path and the secret-leak block path.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'pre-commit.mts')

function setupRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pre-commit-test-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  return dir
}

async function runHook(cwd: string): Promise<{ code: number; stderr: string }> {
  const child = spawn(process.execPath, [HOOK], {
    cwd,
    stdio: 'pipe',
  })
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => resolve({ code: code ?? 0, stderr }))
  })
}

test('pre-commit: passes a clean staged file', async () => {
  const dir = setupRepo()
  try {
    writeFileSync(path.join(dir, 'foo.ts'), 'export const X = 1\n')
    spawnSync('git', ['add', 'foo.ts'], { cwd: dir })
    const { code } = await runHook(dir)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: blocks a staged file with a real personal path', async () => {
  const dir = setupRepo()
  try {
    writeFileSync(
      path.join(dir, 'leak.ts'),
      'export const HOME = "/Users/jdalton/secret"\n',
    )
    spawnSync('git', ['add', 'leak.ts'], { cwd: dir })
    const { code, stderr } = await runHook(dir)
    assert.notStrictEqual(code, 0, 'hook must reject personal-path leaks')
    assert.match(stderr, /\/Users\/jdalton/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: blocks a staged file containing an AWS access key', async () => {
  const dir = setupRepo()
  try {
    writeFileSync(
      path.join(dir, 'aws.txt'),
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n',
    )
    spawnSync('git', ['add', 'aws.txt'], { cwd: dir })
    const { code } = await runHook(dir)
    assert.notStrictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: passes when no files are staged', async () => {
  const dir = setupRepo()
  try {
    const { code } = await runHook(dir)
    assert.strictEqual(code, 0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: blocks staged .env file', async () => {
  const dir = setupRepo()
  try {
    writeFileSync(
      path.join(dir, '.env'),
      'SOCKET_API_TOKEN=sktsec_abc123abc123abc123abc123\n',
    )
    spawnSync('git', ['add', '-f', '.env'], { cwd: dir })
    const { code } = await runHook(dir)
    assert.notStrictEqual(code, 0, 'hook must reject .env files')
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

// Suppress the unused-mkdir warning by referencing it (harness might
// extend with subdir tests later).
void mkdirSync
