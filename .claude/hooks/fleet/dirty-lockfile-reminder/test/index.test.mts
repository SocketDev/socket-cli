// node --test specs for the dirty-lockfile-reminder hook.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  commandTouchesTrigger,
  dirtyLockfilesFromPorcelain,
  formatReminder,
} from '../index.mts'

test('commandTouchesTrigger: git commit', () => {
  assert.strictEqual(
    commandTouchesTrigger('git commit -o pnpm-lock.yaml -m wip'),
    true,
  )
})

test('commandTouchesTrigger: git status', () => {
  assert.strictEqual(commandTouchesTrigger('git status --porcelain'), true)
})

test('commandTouchesTrigger: git add', () => {
  assert.strictEqual(commandTouchesTrigger('git add pnpm-lock.yaml'), true)
})

test('commandTouchesTrigger: pnpm i', () => {
  assert.strictEqual(commandTouchesTrigger('pnpm i'), true)
})

test('commandTouchesTrigger: pnpm install in a pipeline', () => {
  assert.strictEqual(
    commandTouchesTrigger('echo hi && pnpm install --frozen-lockfile'),
    true,
  )
})

test('commandTouchesTrigger: non-git/non-pnpm command does not fire', () => {
  assert.strictEqual(commandTouchesTrigger('ls -la && cat README.md'), false)
})

test('commandTouchesTrigger: node script does not fire', () => {
  assert.strictEqual(commandTouchesTrigger('node scripts/foo.mts'), false)
})

test('dirtyLockfilesFromPorcelain: staged root lockfile', () => {
  assert.deepStrictEqual(dirtyLockfilesFromPorcelain('M  pnpm-lock.yaml'), [
    'pnpm-lock.yaml',
  ])
})

test('dirtyLockfilesFromPorcelain: unstaged root lockfile', () => {
  assert.deepStrictEqual(dirtyLockfilesFromPorcelain(' M pnpm-lock.yaml'), [
    'pnpm-lock.yaml',
  ])
})

test('dirtyLockfilesFromPorcelain: nested lockfile', () => {
  assert.deepStrictEqual(
    dirtyLockfilesFromPorcelain(' M packages/foo/pnpm-lock.yaml'),
    ['packages/foo/pnpm-lock.yaml'],
  )
})

test('dirtyLockfilesFromPorcelain: renamed lockfile keeps the new path', () => {
  assert.deepStrictEqual(
    dirtyLockfilesFromPorcelain('R  old/pnpm-lock.yaml -> new/pnpm-lock.yaml'),
    ['new/pnpm-lock.yaml'],
  )
})

test('dirtyLockfilesFromPorcelain: ignores non-lockfile changes', () => {
  const out = [' M src/index.ts', '?? scratch.txt', 'M  package.json'].join(
    '\n',
  )
  assert.deepStrictEqual(dirtyLockfilesFromPorcelain(out), [])
})

test('dirtyLockfilesFromPorcelain: a file merely NAMED like the lockfile but not it', () => {
  // `my-pnpm-lock.yaml` is not `pnpm-lock.yaml` and has no `/` boundary.
  assert.deepStrictEqual(
    dirtyLockfilesFromPorcelain(' M my-pnpm-lock.yaml'),
    [],
  )
})

test('dirtyLockfilesFromPorcelain: clean tree → empty', () => {
  assert.deepStrictEqual(dirtyLockfilesFromPorcelain(''), [])
})

test('formatReminder: single lockfile names the path + pnpm i', () => {
  const msg = formatReminder(['pnpm-lock.yaml'])
  assert.match(msg, /dirty-lockfile-reminder/)
  assert.match(msg, /`pnpm-lock\.yaml` is dirty/)
  assert.match(msg, /pnpm i/)
  assert.match(msg, /--frozen-lockfile/)
})

test('formatReminder: multiple lockfiles uses a count', () => {
  const msg = formatReminder([
    'pnpm-lock.yaml',
    'packages/a/pnpm-lock.yaml',
  ])
  assert.match(msg, /2 `pnpm-lock\.yaml` files are dirty/)
})
