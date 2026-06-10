// node --test specs for the no-tsx-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'

import { detectTsx, formatBlock } from '../index.mts'

test('detectTsx: bare tsx runner', () => {
  const d = detectTsx('tsx scripts/foo.mts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.kind, 'runner')
  assert.strictEqual(d.tool, 'tsx')
})

test('detectTsx: tsx watch', () => {
  assert.strictEqual(detectTsx('tsx watch src/index.mts').detected, true)
})

test('detectTsx: ts-node runner', () => {
  const d = detectTsx('ts-node script.ts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.tool, 'ts-node')
})

test('detectTsx: node --import tsx (separated)', () => {
  const d = detectTsx('node --import tsx --test test/x.test.mts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.kind, 'loader')
  assert.strictEqual(d.tool, 'tsx')
})

test('detectTsx: node --import=tsx (glued)', () => {
  const d = detectTsx('node --import=tsx foo.mts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.kind, 'loader')
})

test('detectTsx: node --loader tsx/esm', () => {
  const d = detectTsx('node --loader tsx/esm foo.mts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.tool, 'tsx')
})

test('detectTsx: node --require ts-node/register', () => {
  const d = detectTsx('node --require ts-node/register foo.ts')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.kind, 'loader')
  assert.strictEqual(d.tool, 'ts-node')
})

test('detectTsx: node --experimental-loader tsx', () => {
  assert.strictEqual(
    detectTsx('node --experimental-loader tsx foo.mts').detected,
    true,
  )
})

test('detectTsx: tsx in a pipeline', () => {
  assert.strictEqual(detectTsx('echo hi && tsx run.mts').detected, true)
})

test('detectTsx: plain node run is allowed', () => {
  assert.strictEqual(detectTsx('node scripts/foo.mts').detected, false)
})

test('detectTsx: node --test (no tsx) is allowed', () => {
  assert.strictEqual(detectTsx('node --test test/*.test.mts').detected, false)
})

test('detectTsx: a tool merely NAMED like tsx is not tsx', () => {
  // `my-tsx-helper` is a different binary; `--import some-tsx-shim` is a
  // different loader. Neither is the tsx/ts-node tool.
  assert.strictEqual(detectTsx('my-tsx-helper run').detected, false)
  assert.strictEqual(detectTsx('node --import some-tsx-shim foo.mts').detected, false)
})

test('detectTsx: vitest run is allowed', () => {
  assert.strictEqual(
    detectTsx('node_modules/.bin/vitest run foo.test.mts').detected,
    false,
  )
})

test('formatBlock: runner message names the tool + native node', () => {
  const msg = formatBlock({ detected: true, kind: 'runner', tool: 'tsx' })
  assert.match(msg, /no-tsx-guard/)
  assert.match(msg, /verboten/)
  assert.match(msg, /node path\/to\/script\.mts/)
  assert.match(msg, /Allow tsx bypass/)
})

test('formatBlock: loader message mentions the loader form', () => {
  const msg = formatBlock({ detected: true, kind: 'loader', tool: 'tsx' })
  assert.match(msg, /node --import tsx/)
})
