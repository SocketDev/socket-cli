/**
 * @file Smoke test for broken-hook-detector. SessionStart hook (Node built-ins
 *   only, self-imposed) that walks every other hook's index.mts + every
 *   _shared/*.mts, spawns `node --check` on each, and aggregates
 *   ERR_MODULE_NOT_FOUND failures into one structured recovery message.
 *   Fail-open by design. Smoke contract: hook loads + dispatches without
 *   throwing; empty payload → exit 0 (fail-open).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'node:test'
import assert from 'node:assert/strict'

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

async function runHook(
  payload: unknown,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: 'pipe',
      env: { ...process.env, ...env },
    })
    let stdout = ''
    child.stdout.on('data', d => {
      stdout += String(d)
    })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, stdout }))
    child.stdin.end(JSON.stringify(payload))
  })
}

// Build a fixture project dir with a node_modules in the requested state.
function makeProject(
  kind: 'gutted' | 'healthy' | 'no-store' | 'dangling-symlink',
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bhd-proj-'))
  const nm = path.join(dir, 'node_modules')
  mkdirSync(nm, { recursive: true })
  if (kind !== 'no-store') {
    mkdirSync(path.join(nm, '.pnpm'))
    writeFileSync(path.join(nm, '.pnpm', 'placeholder'), 'x')
  }
  if (kind === 'gutted') {
    // store present + stale marker present + @socketsecurity link MISSING
    writeFileSync(path.join(nm, '.pnpm-workspace-state-v1.json'), '{}')
  }
  if (kind === 'healthy') {
    mkdirSync(path.join(nm, '@socketsecurity'))
  }
  if (kind === 'dangling-symlink') {
    // @socketsecurity dir EXISTS (so the gutted check won't fire), but its
    // lib-stable child is a symlink to a NONEXISTENT target (a removed worktree
    // orphaned it) — MODE B. No stale marker.
    mkdirSync(path.join(nm, '@socketsecurity'))
    symlinkSync(
      path.join(nm, '.pnpm', 'gone', 'lib'),
      path.join(nm, '@socketsecurity', 'lib-stable'),
    )
  }
  // A .claude/hooks dir so findHookEntrypoints has something to consider.
  mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true })
  return dir
}

test('empty payload exits 0 (fail-open)', async () => {
  const result = await runHook({})
  // Fail-open: any internal error must exit 0.
  assert.equal(result.code, 0)
})

test('gutted node_modules + already-attempted sentinel → reports manual command, no install', async () => {
  const proj = makeProject('gutted')
  // Pre-set the once-per-session sentinel so the hook takes the "already
  // attempted" branch — it emits guidance and NEVER spawns pnpm in the test.
  const sentinel = path.join(
    tmpdir(),
    `broken-hook-recovery-${proj.replace(/[^a-zA-Z0-9]/g, '_')}.attempted`,
  )
  writeFileSync(sentinel, '')
  const result = await runHook({}, { CLAUDE_PROJECT_DIR: proj })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /gutted/)
  assert.match(result.stdout, /CI=true pnpm install/)
})

test('healthy node_modules → no gutted report (no false positive)', async () => {
  const proj = makeProject('healthy')
  const result = await runHook({}, { CLAUDE_PROJECT_DIR: proj })
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.stdout, /gutted/)
})

test('no .pnpm store (fresh clone) → not flagged gutted', async () => {
  const proj = makeProject('no-store')
  const result = await runHook({}, { CLAUDE_PROJECT_DIR: proj })
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.stdout, /gutted/)
})

test('MODE B: dangling lib-stable symlink + sentinel → reports manual command, no install', async () => {
  // The dangling-symlink fixture: @socketsecurity dir present (so the gutted
  // check stays silent), lib-stable a symlink whose target does not resolve, no
  // stale marker. Pre-set the sentinel so the hook reports without spawning
  // pnpm in the test.
  const proj = makeProject('dangling-symlink')
  const sentinel = path.join(
    tmpdir(),
    `broken-hook-recovery-${proj.replace(/[^a-zA-Z0-9]/g, '_')}.attempted`,
  )
  writeFileSync(sentinel, '')
  const result = await runHook({}, { CLAUDE_PROJECT_DIR: proj })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /dangling @socketsecurity\/lib-stable symlink/)
  assert.match(result.stdout, /CI=true pnpm install/)
})

test('healthy node_modules (plain dir, not a symlink) → no dangling false positive', async () => {
  // The 'healthy' fixture has a plain @socketsecurity dir; the MODE-B lstat
  // check must treat a non-symlink as fine.
  const proj = makeProject('healthy')
  const result = await runHook({}, { CLAUDE_PROJECT_DIR: proj })
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.stdout, /dangling/)
})
