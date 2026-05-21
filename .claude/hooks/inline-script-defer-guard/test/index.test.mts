// node --test specs for the inline-script-defer-guard hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
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

test('non-HTML / non-source file passes', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/note.txt',
      content: '<script defer>do.thing()</script>',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('<script defer src="..."> passes (valid external)', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<!doctype html><script defer src="/main.js"></script>',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('<script async src="..."> passes (valid external)', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<!doctype html><script async src="/main.js"></script>',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('<script> without defer/async passes', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<!doctype html><script>document.title = "x"</script>',
    },
  })
  assert.strictEqual(r.code, 0)
})

test('inline <script defer> in .html blocked', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<!doctype html><script defer>document.title = "x"</script>',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('inline <script async> in .html blocked', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<!doctype html><script async>document.title = "x"</script>',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('inline <script defer> in .njk template blocked', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.njk',
      content: '<script defer>do.thing()</script>',
    },
  })
  assert.strictEqual(r.code, 2)
})

test('bypass phrase passes', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'idef-tx-'))
  const transcriptPath = path.join(dir, 'session.jsonl')
  writeFileSync(
    transcriptPath,
    JSON.stringify({
      type: 'user',
      message: { content: 'Allow inline-defer bypass' },
    }) + '\n',
  )
  const r = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/tmp/page.html',
      content: '<script defer>x()</script>',
    },
    transcript_path: transcriptPath,
  })
  assert.strictEqual(r.code, 0)
})
