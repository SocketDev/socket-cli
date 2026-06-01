// node --test specs for the target-arch-env-guard hook.

// prefer-async-spawn: streaming-stdio-required.
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

function tmpFile(subdir: string, name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'target-arch-guard-test-'))
  const full = path.join(dir, subdir)
  mkdirSync(full, { recursive: true })
  const p = path.join(full, name)
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
    tool_input: { command: 'make' },
  })
  assert.strictEqual(r.code, 0)
})

test('non-builder script passes (file not under scripts/)', async () => {
  const p = tmpFile('src', 'foo.mts', `
    const arch = process.env.TARGET_ARCH
    await spawn('make', [])
  `)
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: p, content: 'see above' },
  })
  assert.strictEqual(r.code, 0)
})

test('builder script with all three conditions blocks', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
const arch = process.env.TARGET_ARCH || process.arch
await spawn('make', ['-j'])
      `,
    },
  })
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /target-arch-env-guard.*Blocked/)
  assert.match(r.stderr, /libpq\.yml/)
})

test('builder script with delete passes', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
const arch = process.env.TARGET_ARCH || process.arch
delete process.env.TARGET_ARCH
await spawn('make', ['-j'])
      `,
    },
  })
  assert.strictEqual(r.code, 0)
})

test('scoped delete (childEnv.TARGET_ARCH) also passes', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
const arch = process.env.TARGET_ARCH
const childEnv = { ...process.env }
delete childEnv.TARGET_ARCH
await spawn('make', ['-j'], { env: childEnv })
      `,
    },
  })
  assert.strictEqual(r.code, 0)
})

test('only reads TARGET_ARCH (no make) passes', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
const arch = process.env.TARGET_ARCH || process.arch
await cmake.build({ target: arch })
      `,
    },
  })
  assert.strictEqual(r.code, 0)
})

test('only spawns make (no TARGET_ARCH) passes', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
await spawn('make', ['-j', '8'])
      `,
    },
  })
  assert.strictEqual(r.code, 0)
})

test('configure script triggers same rule', async () => {
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    'placeholder\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: p,
      content: `
const arch = process.env.TARGET_ARCH
await spawn('./configure', ['--prefix=/tmp'])
      `,
    },
  })
  assert.strictEqual(r.code, 2)
})

test('pre-existing violation not re-flagged', async () => {
  const before = `
const arch = process.env.TARGET_ARCH
await spawn('make', ['-j'])
`
  const p = tmpFile(
    'packages/libfoo-builder/scripts',
    'build.mts',
    before,
  )
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: p,
      old_string: "spawn('make', ['-j'])",
      new_string: "spawn('make', ['-j', '4'])",
    },
  })
  assert.strictEqual(r.code, 0)
})
