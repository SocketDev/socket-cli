// node --test specs for the no-repo-scope-in-fleet-config-guard hook.
// prefer-async-spawn: streaming-stdio-required — the test spawns the hook as a
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the streaming
// ChildProcess surface the lib promise wrapper does not. The hook calls
// `await withEditGuard(...)` at module top level (reads stdin), so importing it
// would hang — it must be exercised by spawning, never importing.

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end(JSON.stringify(payload))
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

// Write a `.config/fleet/oxlintrc.json` fixture with the given JSON, return its
// path. The `/.config/fleet/` segment is what the guard keys on.
function fleetOxlintrc(json: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-scope-guard-'))
  const cfgDir = path.join(dir, '.config', 'fleet')
  mkdirSync(cfgDir, { recursive: true })
  const p = path.join(cfgDir, 'oxlintrc.json')
  writeFileSync(p, json)
  return p
}

const UNIVERSAL = JSON.stringify({
  overrides: [{ files: ['**/test/**', '**/*.mts'] }],
  ignorePatterns: ['**/dist', '**/node_modules'],
})

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } })
  assert.strictEqual(r.code, 0)
})

test('edit to a non-fleet-config file passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'repo-scope-other-'))
  const p = path.join(dir, 'package.json')
  writeFileSync(p, '{"name":"x"}\n')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: '{"name":"y","packages/npm/**":1}' },
  })
  assert.strictEqual(r.code, 0)
})

test('write of a fleet oxlintrc with only universal globs passes', async () => {
  const p = fleetOxlintrc('{}')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: UNIVERSAL },
  })
  assert.strictEqual(r.code, 0)
})

test('write introducing a repo-specific glob is BLOCKED', async () => {
  const p = fleetOxlintrc('{}')
  const withRepoScope = JSON.stringify({
    overrides: [{ files: ['packages/npm/**'], rules: { 'no-null': 'off' } }],
  })
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: withRepoScope },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /repo-specific path-scope/)
  assert.match(r.stderr, /packages\/npm/)
})

test('edit introducing a repo-specific glob is BLOCKED', async () => {
  const p = fleetOxlintrc(UNIVERSAL)
  // Add a non-universal files entry via an Edit.
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: p,
      old_string: '"**/*.mts"',
      new_string: '"**/*.mts"]},{"files":["packages/npm/**"',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /packages\/npm/)
})

test('a pre-existing repo-specific glob does not block an unrelated edit', async () => {
  // The fixture already has a repo-specific glob; an edit that does not touch
  // it should pass (the guard only flags INTRODUCED repo-scopes).
  const existing = JSON.stringify({
    overrides: [{ files: ['packages/npm/**'] }, { files: ['**/*.ts'] }],
    ignorePatterns: ['**/dist'],
  })
  const p = fleetOxlintrc(existing)
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: p, old_string: '**/dist', new_string: '**/build' },
  })
  assert.strictEqual(r.code, 0)
})
