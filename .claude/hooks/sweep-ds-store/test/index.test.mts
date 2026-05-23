/**
 * @file Unit tests for sweepDsStore — the recursive .DS_Store remover used by
 *   the Stop hook. Uses real temp dirs (cheap, < 50ms total) rather than
 *   mocks.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { sweepDsStore } from '../index.mts'

function setup(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'sweep-ds-store-test-'))
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { force: true, recursive: true })
  } catch {
    // best-effort
  }
}

test('sweeps a top-level .DS_Store', async () => {
  const root = setup()
  try {
    writeFileSync(path.join(root, '.DS_Store'), 'binary-junk')
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 1)
    assert.equal(result.swept[0], '.DS_Store')
    assert.equal(existsSync(path.join(root, '.DS_Store')), false)
  } finally {
    cleanup(root)
  }
})

test('sweeps nested .DS_Store files', async () => {
  const root = setup()
  try {
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
    writeFileSync(path.join(root, '.DS_Store'), 'x')
    writeFileSync(path.join(root, 'a', '.DS_Store'), 'x')
    writeFileSync(path.join(root, 'a', 'b', '.DS_Store'), 'x')
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 3)
    assert.equal(existsSync(path.join(root, 'a', 'b', '.DS_Store')), false)
  } finally {
    cleanup(root)
  }
})

test('skips .git/', async () => {
  const root = setup()
  try {
    mkdirSync(path.join(root, '.git'), { recursive: true })
    writeFileSync(path.join(root, '.git', '.DS_Store'), 'x')
    writeFileSync(path.join(root, '.DS_Store'), 'x')
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 1)
    assert.equal(result.swept[0], '.DS_Store')
    // .git/.DS_Store still exists
    assert.equal(existsSync(path.join(root, '.git', '.DS_Store')), true)
  } finally {
    cleanup(root)
  }
})

test('skips node_modules/', async () => {
  const root = setup()
  try {
    mkdirSync(path.join(root, 'node_modules', 'foo'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', 'foo', '.DS_Store'), 'x')
    writeFileSync(path.join(root, '.DS_Store'), 'x')
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 1)
    assert.equal(result.swept[0], '.DS_Store')
  } finally {
    cleanup(root)
  }
})

test('ignores other files with similar names', async () => {
  const root = setup()
  try {
    writeFileSync(path.join(root, '.DS_Store.fixture'), 'x')
    writeFileSync(path.join(root, '_DS_Store'), 'x')
    writeFileSync(path.join(root, '.ds_store'), 'x')
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 0)
    assert.equal(existsSync(path.join(root, '.DS_Store.fixture')), true)
  } finally {
    cleanup(root)
  }
})

test('empty directory tree returns empty result', async () => {
  const root = setup()
  try {
    const result = await sweepDsStore(root)
    assert.equal(result.swept.length, 0)
    assert.equal(result.errors.length, 0)
  } finally {
    cleanup(root)
  }
})

test('non-existent root does not throw', async () => {
  const result = await sweepDsStore('/nonexistent-path-for-test')
  assert.equal(result.swept.length, 0)
  assert.equal(result.errors.length, 0)
})
