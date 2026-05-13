// @ts-expect-error - node:test types via @types/node@catalog work at runtime
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

function runHook(payload: object): { stderr: string; exitCode: number } {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
  })
  return { stderr: result.stderr, exitCode: result.status ?? -1 }
}

test('BLOCKS [submodule] without leading comment', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://example.com/foo\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /gitmodules-comment-guard/)
  assert.match(stderr, /vendor\/foo/)
})

test('ALLOWS [submodule] with canonical # name-version comment', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# semver-7.7.4\n[submodule "vendor/semver"]\n\tpath = vendor/semver\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS multi-hyphen version (liburing-2.14)', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content: '# liburing-2.14\n[submodule "vendor/liburing"]\n\tpath = x\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS v-prefixed version (v25.9.0)', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content: '# node-v25.9.0\n[submodule "vendor/node"]\n\tpath = x\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('BLOCKS [submodule] when blank line separates from comment', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# semver-7.7.4\n\n[submodule "vendor/semver"]\n\tpath = vendor/semver\n',
    },
  })
  assert.equal(exitCode, 2)
})

test('ALLOWS with one-off override marker on [submodule] line', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '[submodule "vendor/foo"] # socket-hook: allow gitmodules-no-comment\n\tpath = x\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('IGNORES non-.gitmodules files', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitignore',
      content: '[submodule "foo"]\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('IGNORES tools other than Edit/Write', () => {
  const { exitCode } = runHook({
    tool_name: 'Read',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content: '[submodule "x"]',
    },
  })
  assert.equal(exitCode, 0)
})

test('handles multiple submodules, blocks only the orphan', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# a-1.0\n[submodule "a"]\n\tpath = a\n' +
        '\n' +
        '[submodule "b"]\n\tpath = b\n' +
        '\n' +
        '# c-3.0\n[submodule "c"]\n\tpath = c\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /submodule "b"/)
  assert.doesNotMatch(stderr, /submodule "a"/)
  assert.doesNotMatch(stderr, /submodule "c"/)
})

test('fails open on malformed JSON', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: 'not-json',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})
