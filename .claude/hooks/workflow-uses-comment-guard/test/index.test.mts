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

const SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'

test('BLOCKS uses: with no comment', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${SHA}\n`,
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /workflow-uses-comment-guard/)
})

test('BLOCKS uses: with comment missing date', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `      - uses: actions/checkout@${SHA} # v6.0.2\n`,
    },
  })
  assert.equal(exitCode, 2)
})

test('BLOCKS uses: with date in wrong format', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `      - uses: actions/checkout@${SHA} # v6.0.2 (May 15 2026)\n`,
    },
  })
  assert.equal(exitCode, 2)
})

test('ALLOWS uses: with canonical comment shape (tag)', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `      - uses: actions/checkout@${SHA} # v6.0.2 (2026-05-15)\n`,
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS uses: with canonical comment shape (branch)', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `      - uses: SocketDev/socket-registry/.github/actions/setup-pnpm@${SHA} # main (2026-05-15)\n`,
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS local-action uses (no SHA)', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: '      - uses: ./.github/actions/setup-rust\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS non-workflow YAML files', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/some/other.yml',
      content: `uses: actions/checkout@${SHA}\n`,
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS one-off override marker', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: `      - uses: third-party/action@${SHA} # socket-hook: allow uses-no-stamp\n`,
    },
  })
  assert.equal(exitCode, 0)
})

test('ALLOWS Edit tool with non-uses new_string', () => {
  const { exitCode } = runHook({
    tool_name: 'Edit',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      new_string: '      shell: bash\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('ignores non-Edit/Write tool calls', () => {
  const { exitCode } = runHook({
    tool_name: 'Read',
    tool_input: { file_path: '/repo/.github/workflows/ci.yml' },
  })
  assert.equal(exitCode, 0)
})

test('fails open on bad JSON', () => {
  const result = spawnSync('node', [HOOK_PATH], {
    input: '{not-json}',
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
})
