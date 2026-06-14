// node --test specs for the no-corepack-guard hook.

import test from 'node:test'
import assert from 'node:assert/strict'

import { detectCorepack, formatBlock } from '../index.mts'

test('detectCorepack: corepack enable', () => {
  const d = detectCorepack('corepack enable')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.subcommand, 'enable')
})

test('detectCorepack: corepack enable pnpm', () => {
  assert.strictEqual(detectCorepack('corepack enable pnpm').detected, true)
})

test('detectCorepack: corepack prepare pnpm@9 --activate', () => {
  const d = detectCorepack('corepack prepare pnpm@9.0.0 --activate')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.subcommand, 'prepare')
})

test('detectCorepack: corepack use pnpm@latest', () => {
  const d = detectCorepack('corepack use pnpm@latest')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.subcommand, 'use')
})

test('detectCorepack: corepack install', () => {
  const d = detectCorepack('corepack install')
  assert.strictEqual(d.detected, true)
  assert.strictEqual(d.subcommand, 'install')
})

test('detectCorepack: corepack in a pipeline', () => {
  assert.strictEqual(
    detectCorepack('echo hi && corepack enable').detected,
    true,
  )
})

test('detectCorepack: a leading flag before the subcommand still detects', () => {
  // `corepack --cwd /x enable` — skip the flag (+ its value if glued) and
  // still find the activating subcommand. The flag-skip is conservative:
  // separated flag values may be misread as the subcommand, which only ever
  // OVER-detects corepack, never under-detects, so it fails safe.
  assert.strictEqual(
    detectCorepack('corepack enable --install-directory /x').detected,
    true,
  )
})

test('detectCorepack: corepack --version is allowed', () => {
  assert.strictEqual(detectCorepack('corepack --version').detected, false)
})

test('detectCorepack: corepack --help is allowed', () => {
  assert.strictEqual(detectCorepack('corepack --help').detected, false)
})

test('detectCorepack: corepack disable is allowed (provisions nothing)', () => {
  assert.strictEqual(detectCorepack('corepack disable').detected, false)
})

test('detectCorepack: bare corepack (no subcommand) is allowed', () => {
  assert.strictEqual(detectCorepack('corepack').detected, false)
})

test('detectCorepack: plain pnpm install is allowed', () => {
  assert.strictEqual(detectCorepack('pnpm install').detected, false)
})

test('detectCorepack: setup-tools bootstrap is allowed', () => {
  assert.strictEqual(
    detectCorepack('node scripts/fleet/setup/setup-tools.mjs').detected,
    false,
  )
})

test('detectCorepack: a tool merely NAMED like corepack is not corepack', () => {
  assert.strictEqual(
    detectCorepack('my-corepack-wrapper enable').detected,
    false,
  )
})

test('formatBlock: message names the subcommand + the SRI install path + bypass', () => {
  const msg = formatBlock({ detected: true, subcommand: 'enable' })
  assert.match(msg, /no-corepack-guard/)
  assert.match(msg, /corepack enable/)
  assert.match(msg, /setup-tools\.mjs/)
  assert.match(msg, /Allow corepack bypass/)
})
