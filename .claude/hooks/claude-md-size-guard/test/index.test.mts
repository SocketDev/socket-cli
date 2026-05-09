// node --test specs for the claude-md-size-guard hook.

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

async function runHook(
  payload: Record<string, unknown>,
  envOverride?: Record<string, string>,
): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], {
    stdio: 'pipe',
    env: { ...process.env, ...envOverride },
  })
  child.stdin.end(JSON.stringify(payload))
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  return new Promise(resolve => {
    child.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

function fleetBlock(bodyBytes: number): string {
  // Build a fleet block whose byte size is approximately bodyBytes.
  // The wrapper markers + minimal text overhead is ~80 bytes; the
  // body is filler.
  const filler = 'x'.repeat(Math.max(0, bodyBytes - 80))
  return [
    '<!-- BEGIN FLEET-CANONICAL -->',
    filler,
    '<!-- END FLEET-CANONICAL -->',
  ].join('\n')
}

test('non-CLAUDE.md targets are ignored', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(100_000), file_path: 'README.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of small fleet block is allowed', async () => {
  const result = await runHook({
    tool_input: { content: fleetBlock(1_000), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of fleet block at exactly 40KB is allowed', async () => {
  const result = await runHook({
    tool_input: { content: fleetBlock(40 * 1024), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('Write of fleet block over 40KB is blocked', async () => {
  const result = await runHook({
    tool_input: { content: fleetBlock(45 * 1024), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /claude-md-size-guard/)
  assert.match(result.stderr, /fleet block too large/)
  assert.match(result.stderr, /docs\/references\//)
})

test('Write of CLAUDE.md without fleet markers is allowed (per-repo only)', async () => {
  const result = await runHook({
    tool_input: { content: 'x'.repeat(100_000), file_path: 'CLAUDE.md' },
    tool_name: 'Write',
  })
  assert.strictEqual(result.code, 0)
})

test('cap override via env var', async () => {
  // Override to 1KB so even a small block trips the cap.
  const result = await runHook(
    {
      tool_input: { content: fleetBlock(2_000), file_path: 'CLAUDE.md' },
      tool_name: 'Write',
    },
    { CLAUDE_MD_FLEET_BLOCK_BYTES: '1024' },
  )
  assert.strictEqual(result.code, 2)
})

test('Edit splice that grows fleet block over cap is blocked', async () => {
  // Write a small base file to disk, then propose an Edit that adds
  // 50KB of body inside the fleet block.
  const dir = mkdtempSync(path.join(tmpdir(), 'claude-md-size-guard-'))
  const file = path.join(dir, 'CLAUDE.md')
  const baseBlock = fleetBlock(1_000)
  writeFileSync(file, baseBlock)
  // The Edit proposes to add 50KB more body before the END marker.
  const oldStr = '<!-- END FLEET-CANONICAL -->'
  const newStr = 'y'.repeat(50 * 1024) + oldStr
  const result = await runHook({
    tool_input: {
      file_path: file,
      new_string: newStr,
      old_string: oldStr,
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /fleet block too large/)
})

test('Edit splice that keeps fleet block under cap is allowed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'claude-md-size-guard-'))
  const file = path.join(dir, 'CLAUDE.md')
  writeFileSync(file, fleetBlock(1_000))
  const oldStr = '<!-- END FLEET-CANONICAL -->'
  const newStr = 'z'.repeat(2_000) + oldStr
  const result = await runHook({
    tool_input: {
      file_path: file,
      new_string: newStr,
      old_string: oldStr,
    },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
})
