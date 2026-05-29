/**
 * @file Smoke test for socket-token-minifier-start. SessionStart hook that
 *   auto-starts the socket-token-minifier proxy on `localhost:7779` and exports
 *   `ANTHROPIC_BASE_URL` only after a health probe succeeds. Fail-closed:
 *   missing proxy means the session uses api.anthropic.com directly, never
 *   silently routes through a broken intermediary. Smoke contract: hook loads +
 *   dispatches without throwing; empty payload → exit 0.
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

test('empty payload exits 0', async () => {
  const result = await runHook({})
  assert.equal(result.code, 0)
})
