/**
 * @file Smoke test for no-file-scope-oxlint-disable-guard.
 *   PreToolUse(Edit|Write) hook that blocks file-scope `oxlint-disable` /
 *   `oxlint-disable-next-line` blocks at the top of a file. The block scope
 *   silently exempts future edits the author never thought about; per-line
 *   disables with rationale are the right shape. Smoke contract:
 *
 *   - benign payload (non-Edit/Write tool, or no oxlint-disable in content) →
 *     exit 0.
 *   - the hook loads + dispatches without throwing.
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

test('benign payload exits 0', async () => {
  const result = await runHook({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/example.ts' },
  })
  assert.equal(result.code, 0)
})
