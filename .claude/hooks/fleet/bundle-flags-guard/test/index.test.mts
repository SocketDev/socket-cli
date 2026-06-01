// node --test specs for the bundle-flags-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-flags-guard-test-'))
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

test('non-Edit/Write tool passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'echo hi' },
  })
  assert.strictEqual(r.code, 0)
})

test('unrelated file passes', async () => {
  const p = tmpFile('README.md', '# hi')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: '# hi\nsourcemap: true\n' },
  })
  assert.strictEqual(r.code, 0)
})

test('tsconfig.json flipping sourceMap to true blocks', async () => {
  const p = tmpFile(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { sourceMap: false } }),
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: JSON.stringify({ compilerOptions: { sourceMap: true } }),
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /bundle-flags-guard.*Blocked/)
  assert.match(r.stderr, /sourceMap/)
})

test('tsconfig.json flipping declarationMap to true blocks', async () => {
  const p = tmpFile(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { declarationMap: false } }),
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: JSON.stringify({ compilerOptions: { declarationMap: true } }),
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /declarationMap/)
})

test('tsconfig.json with comments still parses', async () => {
  const p = tmpFile(
    'tsconfig.json',
    '{\n  // comment\n  "compilerOptions": { "sourceMap": false }\n}\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        '{\n  // comment\n  "compilerOptions": { "sourceMap": true }\n}\n',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('tsconfig.json already-true source passes (no transition)', async () => {
  const p = tmpFile(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { sourceMap: true, strict: false } }),
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: JSON.stringify({
        compilerOptions: { sourceMap: true, strict: true },
      }),
    },
  })
  assert.strictEqual(r.code, 0)
})

test('tsconfig.json flipping true -> false passes', async () => {
  const p = tmpFile(
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { sourceMap: true } }),
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: JSON.stringify({ compilerOptions: { sourceMap: false } }),
    },
  })
  assert.strictEqual(r.code, 0)
})

test('esbuild.config.mts adding minify: true blocks', async () => {
  const p = tmpFile(
    'esbuild.config.mts',
    'export default { entryPoints: [], minify: false }\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: 'export default { entryPoints: [], minify: true }\n',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /minify/)
})

test("rolldown.config.ts adding sourcemap: 'inline' blocks", async () => {
  const p = tmpFile(
    'rolldown.config.ts',
    "export default { input: 'x', sourcemap: false }\n",
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: "export default { input: 'x', sourcemap: 'inline' }\n",
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /sourcemap/)
})

test('bundler config: commented sourcemap: true passes', async () => {
  const p = tmpFile(
    'esbuild.config.mts',
    'export default { entryPoints: [] }\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content:
        'export default { entryPoints: [] }\n// sourcemap: true is forbidden\n',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('test-tree file passes even when flipping', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bfg-test-tree-'))
  const subdir = path.join(dir, 'test', 'fixtures')
  writeFileSync(path.join(dir, 'tsconfig.json'), 'placeholder')
  // Hook checks path string; doesn't need the parent dir to exist.
  const p = path.join(subdir, 'tsconfig.json')
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: JSON.stringify({ compilerOptions: { sourceMap: true } }),
    },
  })
  assert.strictEqual(r.code, 0)
})
