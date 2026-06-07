// node --test specs for .git-hooks/pre-commit.mts.
//
// Smoke tests: spin up a temp git repo, stage a file, run the hook
// from inside it, and inspect exit code + stderr. Covers the clean
// path and the secret-leak block path.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'pre-commit.mts')

function setupRepo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pre-commit-test-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  spawnSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  return dir
}

// Spawn the hook with the GIVEN env (no implicit bypass) and capture
// code + stderr. The fleet `spawn` returns `{ process } & Promise<{ code,
// stderr, … }>` (not a bare ChildProcess) and REJECTS on a non-zero exit with
// an error that still carries `.code` + `.stderr`; await it, treating a
// rejection as the hook's exit result so the blocking (code 1) cases are
// observable. Used directly by the signing-gate tests, which need the gate LIVE.
async function spawnHook(
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stderr: string }> {
  const child = spawn(process.execPath, [HOOK], {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, ...extraEnv },
  })
  try {
    const result = await child
    return {
      code: typeof result.code === 'number' ? result.code : 0,
      stderr: String(result.stderr ?? ''),
    }
  } catch (e) {
    const err = e as { code?: number | undefined; stderr?: unknown }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stderr: String(err.stderr ?? ''),
    }
  }
}

// Most tests verify NON-signing behavior (secret detection, path leak, etc.) —
// bypass the signing-config gate so the unrelated requirement doesn't block.
// The signing-gate tests call spawnHook directly with the gate live.
async function runHook(
  cwd: string,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stderr: string }> {
  return await spawnHook(cwd, {
    SOCKET_PRE_COMMIT_ALLOW_UNSIGNED: '1',
    ...extraEnv,
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

test('pre-commit: blocks when commit.gpgsign is false', async () => {
  const dir = setupRepo() // setupRepo sets gpgsign=false
  try {
    writeFileSync(path.join(dir, 'foo.ts'), 'export const X = 1\n')
    spawnSync('git', ['add', 'foo.ts'], { cwd: dir })
    // No SOCKET_PRE_COMMIT_ALLOW_UNSIGNED → gate fires.
    const { code, stderr } = await spawnHook(dir)
    assert.notStrictEqual(code, 0, 'unsigned config must block the commit')
    assert.match(stderr, /commit\.gpgsign is not enabled/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: blocks when user.signingkey is unset', async () => {
  const dir = setupRepo()
  try {
    // Enable gpgsign locally but ensure no signingkey is set.
    spawnSync('git', ['config', 'commit.gpgsign', 'true'], { cwd: dir })
    writeFileSync(path.join(dir, 'foo.ts'), 'export const X = 1\n')
    spawnSync('git', ['add', 'foo.ts'], { cwd: dir })
    // Isolate git from the developer's global config (where
    // user.signingkey may be set globally) so the test verifies the
    // "no signingkey at all" path. HOME is git's primary lookup for
    // ~/.gitconfig; pointing it at the test dir means git only sees
    // the repo-local config.
    const { code, stderr } = await spawnHook(dir, {
      HOME: dir,
      GIT_CONFIG_GLOBAL: '/dev/null',
    })
    assert.notStrictEqual(code, 0, 'missing signingkey must block')
    assert.match(stderr, /user\.signingkey is not set/i)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: passes when gpgsign=true and signingkey is set', async () => {
  const dir = setupRepo()
  try {
    spawnSync('git', ['config', 'commit.gpgsign', 'true'], { cwd: dir })
    spawnSync('git', ['config', 'user.signingkey', 'TESTKEYID123'], {
      cwd: dir,
    })
    writeFileSync(path.join(dir, 'foo.ts'), 'export const X = 1\n')
    spawnSync('git', ['add', 'foo.ts'], { cwd: dir })
    // Run WITHOUT the bypass env — gate should accept the good config.
    const { code, stderr } = await spawnHook(dir)
    assert.strictEqual(
      code,
      0,
      `signed-config commit should pass; stderr was: ${stderr}`,
    )
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test('pre-commit: SOCKET_PRE_COMMIT_ALLOW_UNSIGNED=1 bypasses the gate', async () => {
  const dir = setupRepo() // gpgsign=false
  try {
    writeFileSync(path.join(dir, 'foo.ts'), 'export const X = 1\n')
    spawnSync('git', ['add', 'foo.ts'], { cwd: dir })
    const { code } = await runHook(dir, {
      SOCKET_PRE_COMMIT_ALLOW_UNSIGNED: '1',
    })
    assert.strictEqual(
      code,
      0,
      'bypass env should allow the unsigned-config commit',
    )
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

// Suppress the unused-mkdir warning by referencing it (harness might
// extend with subdir tests later).
void mkdirSync
