// node --test specs for the oxlint-plugin-load-guard hook.

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { isPluginPath } from '../index.mts'

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

// Importing index.mts runs withEditGuard, which reads stdin. With no stdin
// payload (test import context) it fails open — confirm the module loads
// without throwing and exports the predicate.
test('hook module loads and exports isPluginPath', () => {
  assert.equal(typeof isPluginPath, 'function')
  assert.ok(here.includes('oxlint-plugin-load-guard'))
})
