/**
 * @file Unit tests for the prefer-async-spawn-guard detector.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { findChildProcessImports, isExemptPath } from '../index.mts'

describe('prefer-async-spawn-guard / findChildProcessImports', () => {
  test('flags a node:child_process named import', () => {
    const f = findChildProcessImports(
      "import { spawnSync } from 'node:child_process'\n",
    )
    assert.equal(f.length, 1)
    assert.equal(f[0]!.line, 1)
  })

  test('flags a bare child_process import', () => {
    assert.equal(
      findChildProcessImports("import cp from 'child_process'\n").length,
      1,
    )
  })

  test('flags spawn / exec / execSync named imports too', () => {
    const f = findChildProcessImports(
      "import { spawn, exec, execSync } from 'node:child_process'\n",
    )
    assert.equal(f.length, 1)
  })

  test('flags a require() form', () => {
    assert.equal(
      findChildProcessImports(
        "const { spawnSync } = require('node:child_process')\n",
      ).length,
      1,
    )
  })

  test('flags double-quoted + re-export forms', () => {
    assert.equal(
      findChildProcessImports('export { spawn } from "child_process"\n').length,
      1,
    )
  })

  test('does NOT flag the fleet lib spawn import', () => {
    assert.equal(
      findChildProcessImports(
        "import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'\n",
      ).length,
      0,
    )
  })

  test('does NOT flag unrelated imports or comments mentioning child_process', () => {
    assert.equal(
      findChildProcessImports(
        "import path from 'node:path'\n// we avoid node:child_process here\n",
      ).length,
      0,
    )
  })
})

describe('prefer-async-spawn-guard / isExemptPath', () => {
  test('exempts the hook + rule + self-skip files', () => {
    for (const p of [
      '/repo/.claude/hooks/fleet/prefer-async-spawn-guard/index.mts',
      '/repo/.config/oxlint-plugin/fleet/prefer-async-spawn/index.mts',
      '/repo/.config/oxlint-plugin/fleet/prefer-spawn-over-execsync/index.mts',
      '/repo/.config/fleet/markdownlint-rules/_shared/wheelhouse-self-skip.mjs',
      '/repo/dist/foo.js',
      '/repo/node_modules/x/y.js',
    ]) {
      assert.equal(isExemptPath(p), true, p)
    }
  })

  test('does not exempt ordinary source', () => {
    assert.equal(isExemptPath('/repo/scripts/foo.mts'), false)
    assert.equal(isExemptPath('/repo/src/bar.ts'), false)
  })
})
