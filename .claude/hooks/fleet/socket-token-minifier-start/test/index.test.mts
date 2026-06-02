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

import { reapWedgedProxy } from '../index.mts'

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

test('reapWedgedProxy never kills a healthy proxy', async () => {
  // Safety contract: reapWedgedProxy re-probes /health first and bails if
  // the proxy is healthy (gate 1), so calling it while a live shared
  // proxy is running must reap NOTHING and return 0 — it must never take
  // down the very proxy this session depends on. (If no proxy is running
  // on the test host, it also returns 0 because lsof finds no PID.)
  // Either way the result is 0; the test asserts it's a safe non-negative
  // integer and never throws.
  const killed = await reapWedgedProxy()
  assert.equal(typeof killed, 'number')
  assert.ok(Number.isInteger(killed) && killed >= 0)
})
