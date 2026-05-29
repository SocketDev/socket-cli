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

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

async function runHook(payload: unknown): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1 }))
    child.stdin.end(JSON.stringify(payload))
  })
}

test('empty payload exits 0 (fail-open)', async () => {
  const result = await runHook({})
  // Fail-open: any internal error must exit 0.
  assert.equal(result.code, 0)
})
