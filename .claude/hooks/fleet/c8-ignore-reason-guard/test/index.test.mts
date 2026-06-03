// node --test specs for the c8-ignore-reason-guard hook.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')
const F = '/Users/x/projects/foo/src/mod.ts'

function makeTranscript(userText: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'c8-guard-'))
  const file = path.join(dir, 'session.jsonl')
  writeFileSync(file, JSON.stringify({ role: 'user', content: userText }))
  return file
}

function runHook(payload: object): { code: number; stderr: string } {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload) })
  return { code: r.status ?? -1, stderr: String(r.stderr) }
}

test('BLOCKS `c8 ignore next` with no reason', () => {
  const { code, stderr } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: F, content: '/* c8 ignore next */\nfoo()\n' },
  })
  assert.equal(code, 2)
  assert.match(stderr, /c8-ignore-reason-guard/)
})

test('BLOCKS `c8 ignore next 3` (count, no reason)', () => {
  const { code } = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: F, new_string: '/* c8 ignore next 3 */' },
  })
  assert.equal(code, 2)
})

test('BLOCKS `v8 ignore start` with no reason', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: F, content: '/* v8 ignore start */' },
  })
  assert.equal(code, 2)
})

test('ALLOWS `c8 ignore next - reason`', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: F,
      content: '/* c8 ignore next - external lib error shape */\nx()\n',
    },
  })
  assert.equal(code, 0)
})

test('ALLOWS `c8 ignore next 3 - reason`', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: F,
      content: '/* c8 ignore next 3 - third-party */',
    },
  })
  assert.equal(code, 0)
})

test('ALLOWS `c8 ignore stop` (no reason needed)', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: F, content: '/* c8 ignore stop */' },
  })
  assert.equal(code, 0)
})

test('ALLOWS in a test file (exempt path)', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/foo/test/a.test.ts',
      content: '/* c8 ignore next */',
    },
  })
  assert.equal(code, 0)
})

test('ALLOWS a non-source file', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/Users/x/foo/README.md',
      content: '/* c8 ignore next */',
    },
  })
  assert.equal(code, 0)
})

test('ALLOWS with bypass phrase', () => {
  const { code } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: F, content: '/* c8 ignore next */' },
    transcript_path: makeTranscript('Allow c8-ignore-reason bypass'),
  })
  assert.equal(code, 0)
})

test('IGNORES non-Edit/Write tool', () => {
  const { code } = runHook({
    tool_name: 'Bash',
    tool_input: { command: '/* c8 ignore next */' },
  })
  assert.equal(code, 0)
})

test('fails open on malformed JSON', () => {
  const r = spawnSync('node', [HOOK], { input: 'not-json{' })
  assert.equal(r.status ?? -1, 0)
})
