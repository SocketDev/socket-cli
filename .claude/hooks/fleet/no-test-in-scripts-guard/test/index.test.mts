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

test('blocks a .test.mts under scripts/fleet/test/', async () => {
  const { code, stderr } = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: 'scripts/fleet/test/foo.test.mts', content: 'x' },
  })
  assert.equal(code, 2, `expected block; stderr=${stderr}`)
  assert.ok(stderr.includes('no-test-in-scripts-guard'))
})

test('blocks a .test.* at any depth under scripts/', async () => {
  for (const fp of [
    'scripts/repo/sync-scaffolding/test/bar.test.mts',
    'scripts/foo.test.ts',
    'scripts/a/b/c/deep.test.js',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 2, `expected block for ${fp}`)
  }
})

test('allows .test.* under test/', async () => {
  for (const fp of [
    'test/unit/foo.test.mts',
    'test/unit/sync-scaffolding/bar.test.mts',
    'test/isolated/baz.test.mts',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 0, `expected pass for ${fp}`)
  }
})

test('allows the co-located tooling test homes (not under scripts/)', async () => {
  for (const fp of [
    '.config/oxlint-plugin/fleet/some-rule/test/some-rule.test.mts',
    '.claude/hooks/fleet/some-guard/test/index.test.mts',
    '.git-hooks/fleet/test/pre-commit.test.mts',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook({
      tool_name: 'Write',
      tool_input: { file_path: fp, content: 'x' },
    })
    assert.equal(code, 0, `expected pass for ${fp}`)
  }
})

test('allows non-test files under scripts/', async () => {
  for (const fp of ['scripts/fleet/check.mts', 'scripts/repo/helpers.mts']) {
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
    tool_input: { file_path: 'scripts/fleet/test/foo.test.mts' },
  })
  assert.equal(code, 0)
})
