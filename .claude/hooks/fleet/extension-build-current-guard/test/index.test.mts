import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  readonly stderr: string
  readonly exitCode: number
}

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): RunResult {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  return {
    stderr: String(result.stderr ?? ''),
    exitCode: result.status ?? -1,
  }
}

// Sanity: non-Edit/Write tools no-op

test('ALLOWS non-Edit/Write tools', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS Edit to a non-extension file', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: '/repo/scripts/foo.mts' },
  })
  assert.equal(exitCode, 0)
})

// repoRoot not found: hook exits 0 (fail-open)

test('ALLOWS when repo root cannot be located', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ebcg-'))
  try {
    const { exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: `${dir}/tools/trusted-publisher-extension/src/popup.mts`,
      },
      cwd: dir,
    })
    assert.equal(exitCode, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// PostToolUse exits 0 even on build failure (can't reject the prior call)

test('Returns 0 even when build would fail (PostToolUse contract)', () => {
  // Use a tempdir that LOOKS like a repo root but where pnpm build
  // will fail (no actual extension to build).
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ebcg-'))
  try {
    writeFileSync(path.join(dir, 'package.json'), '{}')
    const toolsDir = path.join(dir, 'tools', 'trusted-publisher-extension')
    const srcDir = path.join(toolsDir, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(path.join(srcDir, 'popup.mts'), '')
    const { exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(srcDir, 'popup.mts'),
      },
      cwd: dir,
    })
    // Build will fail (no pnpm filter target) — but we still exit 0.
    assert.equal(exitCode, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
