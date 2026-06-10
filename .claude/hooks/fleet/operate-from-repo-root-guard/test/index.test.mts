// prefer-async-spawn: streaming-stdio-required — spawns the hook subprocess
// and pipes a Bash payload on stdin, asserting on exit (2 = block, 0 = pass).
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { findCdThenPm, isSubpackageCdTarget } from '../index.mts'

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

// ---------- unit ----------

test('unit: isSubpackageCdTarget', () => {
  assert.equal(isSubpackageCdTarget('packages/foo'), true)
  assert.equal(isSubpackageCdTarget('apps/web'), true)
  // not subpackages of this repo:
  assert.equal(isSubpackageCdTarget('/abs/path'), false)
  assert.equal(isSubpackageCdTarget('~/x'), false)
  assert.equal(isSubpackageCdTarget('-'), false)
  assert.equal(isSubpackageCdTarget('$DIR'), false)
  assert.equal(isSubpackageCdTarget('../sibling-repo'), false)
  assert.equal(isSubpackageCdTarget('.claude/worktrees/topic'), false)
  assert.equal(isSubpackageCdTarget(undefined), false)
})

test('unit: findCdThenPm', () => {
  assert.deepEqual(findCdThenPm('cd packages/foo && pnpm test'), {
    target: 'packages/foo',
    pm: 'pnpm',
  })
  assert.equal(findCdThenPm('pnpm --filter foo test'), undefined)
  assert.equal(findCdThenPm('cd packages/foo'), undefined)
  assert.equal(findCdThenPm('cd .claude/worktrees/x && pnpm build'), undefined)
})

// ---------- integration ----------

test('blocks cd subpackage && pnpm', async () => {
  const { code, stderr } = await runHook('cd packages/foo && pnpm test')
  assert.equal(code, 2, `expected block; stderr=${stderr}`)
  assert.match(stderr, /operate-from-repo-root-guard/)
  assert.match(stderr, /pnpm --filter/)
})

test('blocks cd subpackage && npm / yarn', async () => {
  assert.equal((await runHook('cd apps/web && npm run build')).code, 2)
  assert.equal((await runHook('cd packages/x; yarn test')).code, 2)
})

test('allows pnpm --filter from root', async () => {
  assert.equal((await runHook('pnpm --filter foo test')).code, 0)
})

test('allows bare cd into a subpackage (no chained pm)', async () => {
  assert.equal((await runHook('cd packages/foo')).code, 0)
})

test('allows cd into a worktree then pnpm', async () => {
  assert.equal(
    (await runHook('cd .claude/worktrees/topic && pnpm build')).code,
    0,
  )
})

test('allows cd to an absolute path then pnpm', async () => {
  assert.equal((await runHook('cd /tmp/scratch && pnpm init')).code, 0)
})
