// node --test specs for the vitest-include-vs-node-test-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

interface FixtureOpts {
  vitestInclude: string[]
  testFilePath: string // relative to fake repo root
  testFileContent: string
}

function makeFixture(opts: FixtureOpts): {
  repoRoot: string
  testFile: string
} {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'vit-guard-test-'))
  mkdirSync(path.join(repoRoot, '.config'), { recursive: true })
  writeFileSync(
    path.join(repoRoot, '.config', 'vitest.config.mts'),
    `export default { test: { include: ${JSON.stringify(opts.vitestInclude)} } }\n`,
  )
  const testFile = path.join(repoRoot, opts.testFilePath)
  mkdirSync(path.dirname(testFile), { recursive: true })
  writeFileSync(testFile, opts.testFileContent)
  return { repoRoot, testFile }
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  // v6 lib-stable spawn returns an enriched Promise that rejects on
  // non-zero exit; this test reads stderr + exit via manual listeners
  // instead. Swallow the Promise rejection so it doesn't race the
  // listener-based resolve and trigger "async activity after test ended".
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

test('non-test file passes', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/foo.txt', content: 'hello' },
  })
  assert.strictEqual(r.code, 0)
})

test('vitest API file matches include — passes', async () => {
  const { repoRoot, testFile } = makeFixture({
    vitestInclude: ['scripts/**/*.test.*'],
    testFilePath: 'scripts/test/foo.test.mts',
    testFileContent: "import { test } from 'vitest'\ntest('x', () => {})\n",
  })
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: testFile,
      content: "import { test } from 'vitest'\ntest('x', () => {})\n",
    },
    cwd: repoRoot,
  })
  assert.strictEqual(r.code, 0)
})

test('node:test file under vitest include — blocked', async () => {
  const { repoRoot, testFile } = makeFixture({
    vitestInclude: ['scripts/**/*.test.*'],
    testFilePath: 'scripts/test/foo.test.mts',
    testFileContent: '',
  })
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: testFile,
      content: "import test from 'node:test'\ntest('x', () => {})\n",
    },
    cwd: repoRoot,
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('scripts/**/*.test.*'))
})

test('node:test file outside vitest include — passes', async () => {
  const { repoRoot, testFile } = makeFixture({
    vitestInclude: ['test/**/*.test.*'],
    testFilePath: 'scripts/test/foo.test.mts',
    testFileContent: '',
  })
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: testFile,
      content: "import test from 'node:test'\ntest('x', () => {})\n",
    },
    cwd: repoRoot,
  })
  assert.strictEqual(r.code, 0)
})

test('bypass phrase passes', async () => {
  const { repoRoot, testFile } = makeFixture({
    vitestInclude: ['scripts/**/*.test.*'],
    testFilePath: 'scripts/test/foo.test.mts',
    testFileContent: '',
  })
  const txDir = mkdtempSync(path.join(os.tmpdir(), 'vit-guard-tx-'))
  const transcriptPath = path.join(txDir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow node-test-in-vitest-include bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: testFile,
      content: "import test from 'node:test'\ntest('x', () => {})\n",
    },
    cwd: repoRoot,
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
