import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function makeTranscript(userText?: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'septype-tx-'))
  const p = path.join(dir, 'session.jsonl')
  writeFileSync(p, JSON.stringify({ role: 'user', content: userText ?? 'go' }))
  return p
}

function runHook(
  filePath: string,
  content: string,
  transcriptPath?: string,
  extraEnv: Record<string, string> = {},
): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content },
      transcript_path: transcriptPath,
    }),
    env: { ...process.env, ...extraEnv },
  })
  return { stderr: String(result.stderr), exitCode: result.status ?? -1 }
}

test('BLOCKS inline type specifier mixed with a value import', () => {
  const { stderr, exitCode } = runHook(
    'src/foo.mts',
    `import { Value, type TypeOnly } from './mod'\n`,
  )
  assert.equal(exitCode, 2)
  assert.match(stderr, /prefer-type-import-guard/)
})

test('BLOCKS a lone inline type specifier in braces', () => {
  const { exitCode } = runHook(
    'src/foo.mts',
    `import { type TypeOnly } from './mod'\n`,
  )
  assert.equal(exitCode, 2)
})

test('BLOCKS a multi-line import with an inline type specifier', () => {
  const { exitCode } = runHook(
    'src/foo.mts',
    `import {\n  Value,\n  type TypeOnly,\n} from './mod'\n`,
  )
  assert.equal(exitCode, 2)
})

test('ALLOWS a separate import type statement', () => {
  const { exitCode } = runHook(
    'src/foo.mts',
    `import { Value } from './mod'\nimport type { TypeOnly } from './mod'\n`,
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS a plain value import', () => {
  const { exitCode } = runHook('src/foo.mts', `import { a, b } from './mod'\n`)
  assert.equal(exitCode, 0)
})

test('IGNORES non-source files', () => {
  const { exitCode } = runHook(
    'docs/readme.md',
    `import { Value, type TypeOnly } from './mod'\n`,
  )
  assert.equal(exitCode, 0)
})

test('ALLOWS with bypass phrase', () => {
  const t = makeTranscript('Allow separate-type-import bypass')
  const { exitCode } = runHook(
    'src/foo.mts',
    `import { Value, type TypeOnly } from './mod'\n`,
    t,
  )
  assert.equal(exitCode, 0)
})

test('IGNORES non-Edit/Write tools', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'import { type X, Y } from "z"' },
    }),
  })
  assert.equal(result.status, 0)
})
