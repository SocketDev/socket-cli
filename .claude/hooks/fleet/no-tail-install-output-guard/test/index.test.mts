// node --test specs for the no-tail-install-output-guard hook.
//
// Spawns the hook as a subprocess (matches the production runtime),
// pipes a JSON payload on stdin, captures stderr + exit code.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

interface Result {
  readonly code: number
  readonly stderr: string
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

function bash(command: string): Record<string, unknown> {
  return { tool_input: { command }, tool_name: 'Bash' }
}

test('non-Bash tool calls pass through untouched', async () => {
  const result = await runHook({
    tool_input: { file_path: 'foo.ts', new_string: 'const x = 1' },
    tool_name: 'Edit',
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('empty / unparseable command passes through', async () => {
  assert.strictEqual((await runHook(bash(''))).code, 0)
  assert.strictEqual((await runHook(bash('"unterminated'))).code, 0)
})

test('blocks `pnpm i | tail -5`', async () => {
  const r = await runHook(bash('pnpm i | tail -5'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /no-tail-install-output-guard/)
  assert.match(r.stderr, /pnpm i/)
  assert.match(r.stderr, /tail/)
  assert.match(r.stderr, /grep -iE/)
})

test('blocks `pnpm install 2>&1 | tail -25`', async () => {
  const r = await runHook(bash('pnpm install 2>&1 | tail -25'))
  assert.strictEqual(r.code, 2)
})

test('blocks `pnpm run check | head -50`', async () => {
  const r = await runHook(bash('pnpm run check | head -50'))
  assert.strictEqual(r.code, 2)
  assert.match(r.stderr, /pnpm run check/)
  assert.match(r.stderr, /head/)
})

test('blocks `pnpm run fix --all 2>&1 | tail -25`', async () => {
  const r = await runHook(bash('pnpm run fix --all 2>&1 | tail -25'))
  assert.strictEqual(r.code, 2)
})

test('blocks `pnpm run test | tail -5`', async () => {
  const r = await runHook(bash('pnpm run test | tail -5'))
  assert.strictEqual(r.code, 2)
})

test('blocks `pnpm run build 2>&1 | head -100`', async () => {
  const r = await runHook(bash('pnpm run build 2>&1 | head -100'))
  assert.strictEqual(r.code, 2)
})

test('blocks `pnpm exec vitest 2>&1 | tail -10`', async () => {
  const r = await runHook(bash('pnpm exec vitest 2>&1 | tail -10'))
  assert.strictEqual(r.code, 2)
})

test('blocks leading-env-assignment shape `CI=true pnpm i | tail -5`', async () => {
  const r = await runHook(bash('CI=true pnpm i | tail -5'))
  assert.strictEqual(r.code, 2)
})

test('blocks under `npm` and `yarn` binaries too', async () => {
  const r1 = await runHook(bash('npm install | tail -5'))
  assert.strictEqual(r1.code, 2)
  const r2 = await runHook(bash('yarn install 2>&1 | head -25'))
  assert.strictEqual(r2.code, 2)
})

test('passes `pnpm i | grep warning` (the recommended replacement)', async () => {
  const r = await runHook(bash('pnpm i 2>&1 | grep -iE "warning|error"'))
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('passes `pnpm test | tee log.txt`', async () => {
  const r = await runHook(bash('pnpm test 2>&1 | tee log.txt'))
  assert.strictEqual(r.code, 0)
})

test('passes `pnpm i && echo done | tail -5` (tail consumes echo)', async () => {
  const r = await runHook(bash('pnpm i && echo done | tail -5'))
  assert.strictEqual(r.code, 0)
})

test('passes `git log | tail -20` (unrelated binary)', async () => {
  const r = await runHook(bash('git log --oneline | tail -20'))
  assert.strictEqual(r.code, 0)
})

test('passes `ls | head -10` (unrelated binary)', async () => {
  const r = await runHook(bash('ls -la | head -10'))
  assert.strictEqual(r.code, 0)
})

test('passes `find . -name foo | head -1` (unrelated binary)', async () => {
  const r = await runHook(bash('find . -name foo.txt | head -1'))
  assert.strictEqual(r.code, 0)
})

test('passes `pnpm run lint | tail -5` (lint not in run-script allowlist)', async () => {
  // `run lint` isn't gated by this hook — lint output truncation is not
  // the local-passes-CI-fails pattern this hook targets.
  const r = await runHook(bash('pnpm run lint | tail -5'))
  assert.strictEqual(r.code, 0)
})

test('passes `pnpm i` (no pipe at all)', async () => {
  const r = await runHook(bash('pnpm i'))
  assert.strictEqual(r.code, 0)
})

test('passes `pnpm i 2>&1` (redirect, no pipe to tail)', async () => {
  const r = await runHook(bash('pnpm i 2>&1'))
  assert.strictEqual(r.code, 0)
})

test('passes `echo "pnpm i | tail -5"` (quoted, not a real invocation)', async () => {
  // shell-quote tokenizes the quoted body as a single string, so there
  // is no `|` operator emitted — the bad pattern is not present.
  const r = await runHook(bash('echo "pnpm i | tail -5"'))
  assert.strictEqual(r.code, 0)
})

test('passes git/curl/etc. mixed with tail in adjacent independent commands', async () => {
  const r = await runHook(bash('git status; ls | tail -5'))
  assert.strictEqual(r.code, 0)
})
