// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Env {
  [key: string]: string
}

function runHook(
  opts: {
    cwd?: string | undefined
    env?: Env | undefined
  } = {},
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      cwd: opts.cwd ?? process.cwd(),
      stdio: ['pipe', 'ignore', 'pipe'],
      env: {
        // Default to a sentinel CI value the hook short-circuits on,
        // unless the caller overrides. Most tests want the early-exit
        // path so they don't actually run logout commands.
        ...process.env,
        ...opts.env,
      },
    })
    // v6 lib-stable spawn returns an enriched Promise that rejects on
    // non-zero exit; this test reads stderr + exit via manual listeners
    // instead. Swallow the Promise rejection so it doesn't race the
    // listener-based resolve and trigger "async activity after test ended".
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end('{}\n')
  })
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'auth-rotation-test-'))
  mkdirSync(path.join(dir, '.claude'), { recursive: true })
  return dir
}

test('exits 0 silently when CI env var is set', async () => {
  const repo = makeRepo()
  try {
    const { code, stderr } = await runHook({
      cwd: repo,
      env: { CI: '1' },
    })
    assert.equal(code, 0)
    assert.equal(stderr, '', `expected no output in CI; got: ${stderr}`)
  } finally {
    await safeDelete(repo)
  }
})

test('honors a project-local snooze with future expiry', async () => {
  const repo = makeRepo()
  try {
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    writeFileSync(path.join(repo, '.claude', 'auth-rotation.snooze'), expiry)
    const { code, stderr } = await runHook({
      cwd: repo,
      env: { CI: '' },
    })
    assert.equal(code, 0)
    // Hook should NOT report cleanup of an unexpired snooze.
    assert.ok(
      !stderr.includes('cleared expired snooze'),
      `hook cleared a fresh snooze: ${stderr}`,
    )
  } finally {
    await safeDelete(repo)
  }
})

test('auto-cleans expired project-local snooze and proceeds', async () => {
  const repo = makeRepo()
  const snoozeFile = path.join(repo, '.claude', 'auth-rotation.snooze')
  try {
    const expiry = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    writeFileSync(snoozeFile, expiry)
    const { code } = await runHook({
      cwd: repo,
      // Force CI so the hook short-circuits AFTER snooze handling
      // (which is what we're testing).
      env: { CI: '' },
    })
    assert.equal(code, 0)
    // We can't easily assert on snooze cleanup messaging without
    // also forcing the hook to do real auth detection. The strong
    // assertion is that the file is gone afterward.
    assert.ok(
      !existsSync(snoozeFile),
      'expired snooze file should have been deleted',
    )
  } finally {
    await safeDelete(repo)
  }
})

test('auto-cleans malformed snooze content', async () => {
  const repo = makeRepo()
  const snoozeFile = path.join(repo, '.claude', 'auth-rotation.snooze')
  try {
    writeFileSync(snoozeFile, 'not-an-iso-timestamp\n')
    const { code } = await runHook({
      cwd: repo,
      env: { CI: '' },
    })
    assert.equal(code, 0)
    assert.ok(
      !existsSync(snoozeFile),
      'malformed snooze file should have been deleted',
    )
  } finally {
    await safeDelete(repo)
  }
})

test('auto-cleans empty (legacy) snooze file', async () => {
  const repo = makeRepo()
  const snoozeFile = path.join(repo, '.claude', 'auth-rotation.snooze')
  try {
    writeFileSync(snoozeFile, '')
    const { code } = await runHook({
      cwd: repo,
      env: { CI: '' },
    })
    assert.equal(code, 0)
    assert.ok(
      !existsSync(snoozeFile),
      'empty (legacy) snooze file should have been deleted',
    )
  } finally {
    await safeDelete(repo)
  }
})
