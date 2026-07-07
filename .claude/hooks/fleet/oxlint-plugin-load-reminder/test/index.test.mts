// node --test specs for the oxlint-plugin-load-reminder hook.

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Import the pure predicate from its sibling module, NOT ../index.mts — the
// index runs `await withEditGuard` at module scope (reads stdin on import),
// which hangs the node:test runner ("Interrupted while running").
import { isPluginPath } from '../is-plugin-path.mts'

const here = path.dirname(fileURLToPath(import.meta.url))

test('isPluginPath matches plugin source files', () => {
  assert.equal(
    isPluginPath(
      '/repo/.config/oxlint-plugin/fleet/no-vitest-focused-tests/index.mts',
    ),
    true,
  )
  assert.equal(
    isPluginPath('/repo/.config/oxlint-plugin/lib/vitest-fn-call.mts'),
    true,
  )
  assert.equal(
    isPluginPath('/repo/.config/oxlint-plugin/index.mts'),
    true,
  )
})

test('isPluginPath ignores non-plugin files', () => {
  assert.equal(isPluginPath('/repo/src/foo.ts'), false)
  assert.equal(isPluginPath('/repo/.config/fleet/oxlintrc.json'), false)
  assert.equal(isPluginPath('/repo/test/a.test.mts'), false)
  assert.equal(isPluginPath(''), false)
})

test('the pure predicate is importable without running the hook guard', () => {
  assert.equal(typeof isPluginPath, 'function')
  assert.ok(here.includes('oxlint-plugin-load-reminder'))
})
