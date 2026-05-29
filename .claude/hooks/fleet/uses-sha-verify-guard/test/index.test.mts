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
  return { stderr: result.stderr ?? '', exitCode: result.status ?? -1 }
}

// ------- workflow / action: uses: pin -------

test('BLOCKS workflow `uses:` with truncated SHA', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content:
        'jobs:\n  job:\n    steps:\n      - uses: actions/checkout@abc123\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /uses-sha-verify-guard/)
  assert.match(stderr, /truncated SHA/)
})

test('BLOCKS workflow `uses:` with version tag', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.github/workflows/ci.yml',
      content: '      - uses: actions/checkout@v4\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /not a SHA pin/)
})

test('IGNORES file outside .github/workflows/ + .github/actions/', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/README.md',
      content: '      - uses: actions/checkout@v4\n',
    },
  })
  assert.equal(exitCode, 0)
})

test('IGNORES non-Edit/Write tools', () => {
  const { exitCode } = runHook({
    tool_name: 'Bash',
    tool_input: { command: 'git status' },
  })
  assert.equal(exitCode, 0)
})

// ------- .gitmodules: BOTH header + ref required -------

test('BLOCKS .gitmodules submodule missing both header + ref', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://github.com/owner/foo.git\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /missing.*sha256:<64hex>/)
  assert.match(stderr, /missing `ref = <40hex>`/)
})

test('BLOCKS .gitmodules submodule with header but no ref', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# foo-1.2.3 sha256:' +
        'a'.repeat(64) +
        '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\turl = https://github.com/owner/foo.git\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /missing `ref = <40hex>`/)
})

test('BLOCKS .gitmodules header sha256 of wrong length', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# foo-1.2.3 sha256:' +
        'a'.repeat(32) +
        '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\tref = ' +
        'b'.repeat(40) +
        '\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /sha256 must be exactly 64 hex chars/)
})

test('BLOCKS .gitmodules ref of wrong length', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/.gitmodules',
      content:
        '# foo-1.2.3 sha256:' +
        'a'.repeat(64) +
        '\n[submodule "vendor/foo"]\n\tpath = vendor/foo\n\tref = abc123\n',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /ref must be exactly 40 hex chars/)
})

// ------- package.json GitHub URL deps -------

test('BLOCKS package.json git+https://github.com URL with truncated SHA', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/package.json',
      content:
        '{"dependencies": {"foo": "git+https://github.com/owner/foo#abc123"}}',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /truncated SHA/)
})

test('BLOCKS package.json git+https://github.com URL with version tag', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/package.json',
      content:
        '{"dependencies": {"foo": "git+https://github.com/owner/foo.git#v1.2.3"}}',
    },
  })
  assert.equal(exitCode, 2)
  assert.match(stderr, /not a SHA pin/)
})

test('IGNORES node_modules/package.json', () => {
  const { exitCode } = runHook({
    tool_name: 'Write',
    tool_input: {
      file_path: '/repo/node_modules/foo/package.json',
      content: '{"dependencies": {"x": "git+https://github.com/owner/x#abc"}}',
    },
  })
  assert.equal(exitCode, 0)
})
