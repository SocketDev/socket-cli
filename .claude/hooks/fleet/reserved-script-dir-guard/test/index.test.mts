// prefer-async-spawn: streaming-stdio-required — test spawns the hook as a
// child subprocess and pipes a PreToolUse payload on stdin, asserting on the
// exit code (2 = block, 0 = pass). Importing index.mts directly would trigger
// its top-level withEditGuard (which reads stdin), so we spawn instead.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

interface Payload {
  tool_name: 'Edit' | 'Write' | string
  tool_input: { file_path?: string | undefined; content?: string | undefined }
}

function runHook(payload: Payload): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    void child.catch(() => undefined)
    let stderr = ''
    child.process.stderr!.on('data', d => {
      stderr += d.toString()
    })
    child.process.on('error', reject)
    child.process.on('exit', code => {
      resolve({ code: code ?? -1, stderr })
    })
    child.stdin!.end(JSON.stringify(payload))
  })
}

test('blocks scripts/build/', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: 'scripts/build/cli.mts', content: 'x' },
  })
  assert.equal(code, 2, `expected block; stderr=${stderr}`)
  assert.ok(stderr.includes('reserved-script-dir-guard'))
})

test('blocks scripts/dist/ and scripts/node_modules/', async () => {
  for (const fp of ['scripts/dist/x.mts', 'scripts/node_modules/y.mts']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 2, `expected block for ${fp}`)
  }
})

test('allows scripts/fleet/ and scripts/repo/', async () => {
  for (const fp of ['scripts/fleet/check.mts', 'scripts/repo/sync.mts']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 0, `expected pass for ${fp}`)
  }
})

test('allows descriptive feature dirs + build-* prefix', async () => {
  for (const fp of [
    'scripts/bundle/clean.mts',
    'scripts/post-build/run.mts',
    'scripts/build-externals/x.mts',
    'scripts/_shared/util.mts',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 0, `expected pass for ${fp}`)
  }
})

test('ignores non-Edit/Write tools', async () => {
  const { code } = await runHook({
    tool_name: 'Bash',
    tool_input: { file_path: 'scripts/build/cli.mts' },
  })
  assert.equal(code, 0)
})
