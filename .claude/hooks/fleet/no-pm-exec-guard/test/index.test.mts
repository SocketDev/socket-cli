// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess
// and pipes a Bash payload on stdin, asserting on exit (2 = block, 0 = pass).
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '..', 'index.mts')

function runHook(command: string): Promise<{ code: number; stderr: string }> {
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
    child.stdin!.end(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    )
  })
}

test('blocks pnpm exec', async () => {
  const { code, stderr } = await runHook('pnpm exec tsgo --noEmit')
  assert.equal(code, 2, `expected block; stderr=${stderr}`)
  assert.ok(stderr.includes('no-pm-exec-guard'))
})

test('blocks npm exec and yarn exec', async () => {
  for (const cmd of ['npm exec vitest run', 'yarn exec eslint .']) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
  }
})

test('blocks pnpm exec in a chain / behind env vars', async () => {
  for (const cmd of [
    'cd packages/x && pnpm exec tsgo',
    'CI=true pnpm exec vitest run a.test.mts',
    'echo hi | pnpm exec cowsay',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
  }
})

test('allows node_modules/.bin and pnpm run', async () => {
  for (const cmd of [
    'node_modules/.bin/tsgo --noEmit',
    'pnpm run check',
    'pnpm install',
    'pnpm run test -- a.test.mts',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 0, `expected pass for: ${cmd}`)
  }
})

test('blocks the fetch+execute forms: npx / pnpm dlx / yarn dlx', async () => {
  for (const cmd of [
    'npx cowsay hi',
    'pnpm dlx execa echo',
    'yarn dlx prettier --check .',
    'cd packages/x && npx tsx run.ts',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code, stderr } = await runHook(cmd)
    assert.equal(code, 2, `expected block for: ${cmd}`)
    assert.ok(stderr.includes('no-pm-exec-guard'), `stderr for: ${cmd}`)
  }
})

test('does not false-match an exec/dlx substring inside other tokens', async () => {
  for (const cmd of [
    'echo "pnpm exec is banned"',
    'echo "do not run npx here"',
    'pnpm run exec-tests',
    'node_modules/.bin/dlx-lookalike',
  ]) {
    // eslint-disable-next-line no-await-in-loop -- serial subprocess calls
    const { code } = await runHook(cmd)
    assert.equal(code, 0, `expected pass for: ${cmd}`)
  }
})
