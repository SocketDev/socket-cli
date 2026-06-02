/**
 * @file Unit tests for no-boolean-trap-guard's pure detectors.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findBooleanTrapParams, isExemptPath } from '../index.mts'

test('flags a two-param function with a boolean positional', () => {
  const f = findBooleanTrapParams(
    'function copy(src: string, overwrite: boolean): void {}',
  )
  assert.equal(f.length, 1)
  assert.equal(f[0]!.param, 'overwrite')
})

test('flags an optional boolean positional', () => {
  const f = findBooleanTrapParams(
    'async function run(cmd: string, dry?: boolean): Promise<void> {}',
  )
  assert.equal(f.length, 1)
  assert.equal(f[0]!.param, 'dry')
})

test('flags boolean | undefined positional', () => {
  const f = findBooleanTrapParams(
    'export function start(port: number, verbose: boolean | undefined): void {}',
  )
  assert.equal(f.length, 1)
})

test('does NOT flag a single boolean param (predicate pattern)', () => {
  const f = findBooleanTrapParams(
    'function isEnabled(value: boolean): boolean { return value }',
  )
  assert.equal(f.length, 0)
})

test('does NOT flag an options object param', () => {
  const f = findBooleanTrapParams(
    'export function run(cmd: string, options?: RunOptions | undefined): void {}',
  )
  assert.equal(f.length, 0)
})

test('does NOT flag a boolean field inside an interface body', () => {
  const f = findBooleanTrapParams('  dry?: boolean | undefined')
  assert.equal(f.length, 0)
})

test('isExemptPath: dist files are exempt', () => {
  assert.equal(isExemptPath('/r/dist/index.js'), true)
})

test('isExemptPath: src files are not exempt', () => {
  assert.equal(isExemptPath('/r/src/util.ts'), false)
})
