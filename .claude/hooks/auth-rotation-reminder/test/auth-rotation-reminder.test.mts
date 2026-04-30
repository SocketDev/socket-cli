import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Env {
  [key: string]: string
}

function runHook(opts: {
  cwd?: string
  env?: Env
} = {}): Promise<{ code: number; stderr: string }> {
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
    let stderr = ''
    child.stderr.on('data', d => {
      stderr += d.toString()
    })
    child.on('error', reject)
    child.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin.end('{}\n')
  })
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'auth-rotation-test-'))
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
    rmSync(repo, { recursive: true, force: true })
  }
})

test('exits 0 silently when SOCKET_AUTH_ROTATION_DISABLED is set', async () => {
  const repo = makeRepo()
  try {
    const { code, stderr } = await runHook({
      cwd: repo,
      env: {
        CI: '',
        SOCKET_AUTH_ROTATION_DISABLED: '1',
      },
    })
    assert.equal(code, 0)
    assert.equal(stderr, '')
  } finally {
    rmSync(repo, { recursive: true, force: true })
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
    rmSync(repo, { recursive: true, force: true })
  }
})

test('auto-cleans expired project-local snooze and proceeds', async () => {
  const repo = makeRepo()
  const snoozeFile = path.join(repo, '.claude', 'auth-rotation.snooze')
  try {
    const expiry = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    writeFileSync(snoozeFile, expiry)
    const { code, stderr } = await runHook({
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
    rmSync(repo, { recursive: true, force: true })
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
    rmSync(repo, { recursive: true, force: true })
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
    rmSync(repo, { recursive: true, force: true })
  }
})
