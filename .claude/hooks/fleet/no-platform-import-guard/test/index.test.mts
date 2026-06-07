// node --test specs for the no-platform-import-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns child
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'no-platform-import-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

type Result = { code: number; stderr: string }

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

// A file path that is NOT inside a platform-split module dir (http-request /
// logger), so isExemptPath does not short-circuit the scan.
const SRC_FILE = '/Users/x/projects/socket-foo/src/api/client.mts'

test('blocks a direct /node http-request import (Write)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "import { httpJson } from '../http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 2)
  assert.match(result.stderr, /no-platform-import-guard/)
})

test('blocks a direct /browser http-request import', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "import { httpJson } from '../http-request/browser'\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks a platform import of the logger module', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        "import { getDefaultLogger } from '@socketsecurity/lib/logger/node'\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks a platform import via a package path with a file extension', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        "import { httpJson } from '@socketsecurity/lib/http-request/browser.js'\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks a re-export (export ... from) of a platform entry point', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "export { httpJson } from './http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('blocks a platform import landed via Edit (new_string)', async () => {
  const result = await runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: SRC_FILE,
      new_string: "import { httpJson } from '../http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 2)
})

test('allows the platform-agnostic directory import (no suffix)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content: "import { httpJson } from '../http-request'\n",
    },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('passes through a non-Edit/Write tool call (Bash)', async () => {
  const result = await runHook({
    tool_name: 'Bash',
    tool_input: { command: "node -e \"import('../http-request/node')\"" },
  })
  assert.strictEqual(result.code, 0)
  assert.strictEqual(result.stderr, '')
})

test('exempts files inside the http-request module dir', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/projects/socket-foo/src/http-request/index.mts',
      content: "import { httpJson } from './http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('exempts files inside the logger module dir', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/projects/socket-foo/src/logger/default.mts',
      content: "import { sink } from './logger/node'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('inline // no-platform-http-import: comment on the preceding line allows the import', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: SRC_FILE,
      content:
        "// no-platform-http-import: server-only module\nimport { httpJson } from '../http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('bypass phrase in the transcript allows the platform import', async () => {
  const transcript = makeTranscript('Allow platform-http-import bypass')
  const result = await runHook({
    tool_name: 'Write',
    transcript_path: transcript,
    tool_input: {
      file_path: SRC_FILE,
      content: "import { httpJson } from '../http-request/node'\n",
    },
  })
  assert.strictEqual(result.code, 0)
})

test('empty content is ignored (fails open, exit 0)', async () => {
  const result = await runHook({
    tool_name: 'Write',
    tool_input: { file_path: SRC_FILE, content: '' },
  })
  assert.strictEqual(result.code, 0)
})

test('malformed stdin fails open (exit 0, no crash)', async () => {
  const child = spawn(process.execPath, [HOOK], { stdio: 'pipe' })
  void child.catch(() => undefined)
  child.stdin!.end('}{ not json at all')
  let stderr = ''
  child.process.stderr!.on('data', chunk => {
    stderr += chunk.toString('utf8')
  })
  const result: Result = await new Promise(resolve => {
    child.process.on('exit', code => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.strictEqual(result.code, 0)
  assert.doesNotMatch(result.stderr, /no-platform-import-guard\] Blocked/)
})
