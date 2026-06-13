/**
 * @file Unit tests for isFleetManagedPath — the detector lint-parity guards
 *   use (via withEditGuard's `fleetOnly`) to skip files in a non-fleet repo.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { isFleetManagedDir, isFleetManagedPath } from '../fleet-repo.mts'

function tmpRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'fleet-repo-test-'))
}

test('a repo whose root has .config/fleet/ is fleet-managed', () => {
  const root = tmpRoot()
  mkdirSync(path.join(root, '.git'), { recursive: true })
  mkdirSync(path.join(root, '.config', 'fleet'), { recursive: true })
  mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src', 'index.ts')
  writeFileSync(file, 'export const x = 1')
  assert.strictEqual(isFleetManagedPath(file), true)
})

test('a repo with .git but no .config/fleet/ is NOT fleet-managed', () => {
  const root = tmpRoot()
  mkdirSync(path.join(root, '.git'), { recursive: true })
  mkdirSync(path.join(root, 'src'))
  const file = path.join(root, 'src', 'index.ts')
  writeFileSync(file, 'const red = () => 1')
  assert.strictEqual(isFleetManagedPath(file), false)
})

test('.config/fleet/ found above a nested file still counts', () => {
  const root = tmpRoot()
  mkdirSync(path.join(root, '.git'), { recursive: true })
  mkdirSync(path.join(root, '.config', 'fleet'), { recursive: true })
  const deep = path.join(root, 'a', 'b', 'c')
  mkdirSync(deep, { recursive: true })
  const file = path.join(deep, 'deep.ts')
  writeFileSync(file, 'x')
  assert.strictEqual(isFleetManagedPath(file), true)
})

test('a non-fleet repo with .config/ but no fleet/ subdir is NOT fleet-managed', () => {
  const root = tmpRoot()
  mkdirSync(path.join(root, '.git'), { recursive: true })
  mkdirSync(path.join(root, '.config'), { recursive: true })
  const file = path.join(root, 'index.ts')
  writeFileSync(file, 'x')
  assert.strictEqual(isFleetManagedPath(file), false)
})

test('undeterminable path (no .git ancestor) fails safe to fleet-managed', () => {
  // A bare tmp file with no repo root above it: assume fleet so the guard
  // keeps enforcing rather than silently going quiet.
  const root = tmpRoot()
  const file = path.join(root, 'loose.ts')
  writeFileSync(file, 'x')
  assert.strictEqual(isFleetManagedPath(file), true)
})

test('empty path fails safe to fleet-managed', () => {
  assert.strictEqual(isFleetManagedPath(''), true)
})

test('isFleetManagedDir: dir with .config/fleet is managed, .git-only is not', () => {
  const fleet = tmpRoot()
  mkdirSync(path.join(fleet, '.git'), { recursive: true })
  mkdirSync(path.join(fleet, '.config', 'fleet'), { recursive: true })
  assert.strictEqual(isFleetManagedDir(fleet), true)

  const nonFleet = tmpRoot()
  mkdirSync(path.join(nonFleet, '.git'), { recursive: true })
  assert.strictEqual(isFleetManagedDir(nonFleet), false)
})
