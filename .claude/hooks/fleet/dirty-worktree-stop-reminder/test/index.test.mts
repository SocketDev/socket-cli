// node --test specs for the dirty-worktree-stop-reminder hook.

import test from 'node:test'
import assert from 'node:assert/strict'

import { isUntrackedByDefault, parsePorcelain } from '../index.mts'

test('isUntrackedByDefault: vendor/ prefix', () => {
  assert.strictEqual(isUntrackedByDefault('vendor/foo.cc'), true)
})

test('isUntrackedByDefault: third_party/ prefix', () => {
  assert.strictEqual(isUntrackedByDefault('third_party/lib/x.h'), true)
})

test('isUntrackedByDefault: upstream/ prefix', () => {
  assert.strictEqual(isUntrackedByDefault('upstream/node/src/foo.cc'), true)
})

test('isUntrackedByDefault: additions/source-patched/ prefix', () => {
  assert.strictEqual(
    isUntrackedByDefault('additions/source-patched/bin-infra/main.js'),
    true,
  )
})

test('isUntrackedByDefault: deps/ prefix', () => {
  assert.strictEqual(isUntrackedByDefault('deps/curl/src.c'), true)
})

test('isUntrackedByDefault: pkg-node/ prefix', () => {
  assert.strictEqual(isUntrackedByDefault('pkg-node/foo.js'), true)
})

test('isUntrackedByDefault: *-bundled component', () => {
  assert.strictEqual(isUntrackedByDefault('something-bundled/x.js'), true)
  assert.strictEqual(isUntrackedByDefault('packages/foo-bundled/a.ts'), true)
})

test('isUntrackedByDefault: *-vendored component', () => {
  assert.strictEqual(isUntrackedByDefault('node-vendored/file.cc'), true)
})

test('isUntrackedByDefault: ordinary tracked path', () => {
  assert.strictEqual(isUntrackedByDefault('src/index.ts'), false)
  assert.strictEqual(isUntrackedByDefault('packages/foo/lib/x.ts'), false)
  assert.strictEqual(
    isUntrackedByDefault('.github/workflows/release.yml'),
    false,
  )
})

test('parsePorcelain: modified + untracked + staged', () => {
  const out = [
    ' M src/index.ts',
    '?? new-file.md',
    'M  staged.ts',
    'A  added.ts',
    '',
  ].join('\n')
  const entries = parsePorcelain(out)
  assert.strictEqual(entries.length, 4)
  assert.deepStrictEqual(entries.map(e => e.path).toSorted(), [
    'added.ts',
    'new-file.md',
    'src/index.ts',
    'staged.ts',
  ])
})

test('parsePorcelain: rename uses destination', () => {
  const out = 'R  old/path.ts -> new/path.ts\n'
  const entries = parsePorcelain(out)
  assert.strictEqual(entries.length, 1)
  assert.strictEqual(entries[0]!.path, 'new/path.ts')
})

test('parsePorcelain: filters vendor/upstream', () => {
  const out = [
    ' M src/real.ts',
    ' M vendor/skip.cc',
    ' M upstream/node/skip.cc',
    '?? third_party/skip.h',
    '',
  ].join('\n')
  const entries = parsePorcelain(out)
  assert.strictEqual(entries.length, 1)
  assert.strictEqual(entries[0]!.path, 'src/real.ts')
})

test('parsePorcelain: empty input', () => {
  assert.deepStrictEqual(parsePorcelain(''), [])
  assert.deepStrictEqual(parsePorcelain('\n\n'), [])
})
