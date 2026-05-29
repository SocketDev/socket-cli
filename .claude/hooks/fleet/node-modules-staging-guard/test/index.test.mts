// node --test specs for the node-modules-staging-guard hook.

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

test('non-Bash passes', async () => {
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: { file_path: '/tmp/foo' },
  })
  assert.strictEqual(r.code, 0)
})

test('git add (no -f) passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git add .claude/hooks/foo/index.mts' },
  })
  assert.strictEqual(r.code, 0)
})

test('git add -f of non-node_modules file passes', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git add -f dist/generated-but-ignored.json' },
  })
  assert.strictEqual(r.code, 0)
})

test('git add -f node_modules path blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git add -f .claude/hooks/fleet/check-new-deps/node_modules/',
    },
  })
  assert.strictEqual(r.code, 2)
  assert.ok(String(r.stderr).includes('node_modules'))
})

test('git add --force node_modules path blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command: 'git add --force packages/foo/node_modules/some-pkg',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('git add -f hook package-lock.json blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git add -f .claude/hooks/foo/package-lock.json' },
  })
  assert.strictEqual(r.code, 2)
})

test('chained: legitimate add followed by force-add of node_modules blocked', async () => {
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: {
      command:
        'git add src/foo.ts && git add -f .claude/hooks/bar/node_modules/',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('bypass phrase passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-stage-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow node-modules-staging bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git add -f .claude/hooks/foo/node_modules/' },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
