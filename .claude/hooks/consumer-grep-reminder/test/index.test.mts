// node --test specs for the consumer-grep-reminder hook.

// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

function mkRepo(opts: { consumerDirs?: string[] | undefined } = {}): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'consumer-grep-test-'))
  mkdirSync(path.join(repo, '.git'), { recursive: true })
  for (const d of opts.consumerDirs ?? []) {
    mkdirSync(path.join(repo, d), { recursive: true })
  }
  return repo
}

async function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
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

test('non-Edit passes silently', async () => {
  const r = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/foo.css', content: '.x {}' },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('Edit with no removals — no reminder', async () => {
  const repo = mkRepo({ consumerDirs: ['upstream'] })
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(repo, 'app.css'),
      old_string: '.foo-bar { color: red }\n',
      new_string: '.foo-bar { color: red }\n.baz-qux { color: blue }\n',
    },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('Edit removing CSS class in repo WITH upstream/ — reminder fires', async () => {
  const repo = mkRepo({ consumerDirs: ['upstream'] })
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(repo, 'app.css'),
      old_string: '.foo-bar { color: red }\n.keep-me { color: blue }\n',
      new_string: '.keep-me { color: blue }\n',
    },
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('consumer-grep-reminder'))
  assert.ok(String(r.stderr).includes('foo-bar'))
})

test('Edit removing CSS class in repo WITHOUT consumer subtree — no reminder', async () => {
  const repo = mkRepo()
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(repo, 'app.css'),
      old_string: '.foo-bar {}\n',
      new_string: '',
    },
  })
  assert.strictEqual(r.code, 0)
  assert.strictEqual(r.stderr, '')
})

test('Edit removing data-attribute in repo with vendor/ — reminder fires', async () => {
  const repo = mkRepo({ consumerDirs: ['vendor'] })
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(repo, 'page.html'),
      old_string: '<div data-hydrate-target>x</div>',
      new_string: '<div>x</div>',
    },
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('data-hydrate-target'))
})

test('Edit removing a named export with third_party/ — reminder fires', async () => {
  const repo = mkRepo({ consumerDirs: ['third_party'] })
  const r = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(repo, 'index.ts'),
      old_string:
        'export const oldApi = () => 1\nexport const kept = () => 2\n',
      new_string: 'export const kept = () => 2\n',
    },
  })
  assert.strictEqual(r.code, 0)
  assert.ok(String(r.stderr).includes('oldApi'))
})
