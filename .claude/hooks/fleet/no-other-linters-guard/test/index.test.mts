// Tests for no-other-linters-guard.

// prefer-async-spawn: streaming-stdio-required — test spawns child subprocess
// and pipes stdin/stdout/stderr; Node spawn returns the streaming surface.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpFile(name: string, content: string, subdir?: string): string {
  let dir = mkdtempSync(path.join(os.tmpdir(), 'no-other-linters-test-'))
  if (subdir) {
    dir = path.join(dir, subdir)
    mkdirSync(dir, { recursive: true })
  }
  const p = path.join(dir, name)
  writeFileSync(p, content)
  return p
}

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

const PJ_WITH_ESLINT =
  '{\n  "name": "x",\n  "devDependencies": { "eslint": "^9.0.0" }\n}\n'
const PJ_WITH_BIOME =
  '{\n  "name": "x",\n  "devDependencies": { "@biomejs/biome": "2.2.4" }\n}\n'
const PJ_WITH_TSESLINT =
  '{\n  "name": "x",\n  "devDependencies": { "@typescript-eslint/parser": "^8.0.0" }\n}\n'
const PJ_CLEAN =
  '{\n  "name": "x",\n  "devDependencies": { "oxlint": "1.0.0", "@types/node": "24.0.0" }\n}\n'

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('blocks creating a biome.json config', async () => {
  const p = tmpFile('biome.json', '{ "formatter": { "enabled": true } }')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: '{ "formatter": { "enabled": true } }',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /foreign linter\/formatter config/)
})

test('blocks creating an eslint.config.mjs', async () => {
  const p = tmpFile('eslint.config.mjs', 'export default []')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: 'export default []' },
  })
  assert.strictEqual(r.code, 2)
})

test('blocks .prettierrc', async () => {
  const p = tmpFile('.prettierrc', '{}')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: '{}' },
  })
  assert.strictEqual(r.code, 2)
})

test('blocks adding eslint to package.json devDependencies', async () => {
  const p = tmpFile('package.json', PJ_WITH_ESLINT)
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: PJ_WITH_ESLINT },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /eslint/)
})

test('blocks adding @biomejs/biome to package.json', async () => {
  const p = tmpFile('package.json', PJ_WITH_BIOME)
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: PJ_WITH_BIOME },
  })
  assert.strictEqual(r.code, 2)
})

test('blocks the @typescript-eslint/* scoped family', async () => {
  const p = tmpFile('package.json', PJ_WITH_TSESLINT)
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: PJ_WITH_TSESLINT },
  })
  assert.strictEqual(r.code, 2)
})

test('clean package.json (oxlint only) passes', async () => {
  const p = tmpFile('package.json', PJ_CLEAN)
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: PJ_CLEAN },
  })
  assert.strictEqual(r.code, 0, r.stderr)
})

test('vendored upstream/ biome.json is exempt', async () => {
  const p = tmpFile('biome.json', '{}', 'upstream/acorn')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: '{}' },
  })
  assert.strictEqual(r.code, 0, r.stderr)
})

test('a *-upstream package.json with eslint is exempt', async () => {
  const p = tmpFile('package.json', PJ_WITH_ESLINT, 'acorn-upstream')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: PJ_WITH_ESLINT },
  })
  assert.strictEqual(r.code, 0, r.stderr)
})

test('a non-config, non-package file passes', async () => {
  const p = tmpFile('index.ts', 'export const x = 1')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: 'export const x = 1' },
  })
  assert.strictEqual(r.code, 0, r.stderr)
})

test('malformed JSON package.json fails open (no block)', async () => {
  const p = tmpFile('package.json', '{ not json')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: '{ not json' },
  })
  assert.strictEqual(r.code, 0, r.stderr)
})
