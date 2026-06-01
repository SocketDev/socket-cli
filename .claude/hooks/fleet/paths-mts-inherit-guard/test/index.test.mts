/**
 * @file Unit tests for paths-mts-inherit-guard. Test strategy: spawn the hook
 *   with a JSON payload on stdin and assert the exit code + stderr. Mirrors the
 *   shape used by the no-revert-guard / no-external-issue-ref-guard tests.
 */

import assert from 'node:assert/strict'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, test } from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(__dirname, '..', 'index.mts')

interface RunResult {
  code: number
  stderr: string
}

function runHook(payload: object): RunResult {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
  })
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    stderr: String(r.stderr || ''),
  }
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'paths-mts-inherit-guard-'))
  // Repo-root scripts/fleet/paths.mts — the canonical ancestor after the
  // scripts/{fleet,repo} segmentation. findAncestorPathsMts must discover this
  // (not just the pre-segmentation scripts/paths.mts) so sub-packages stay
  // enforced.
  mkdirSync(path.join(tmpRoot, 'scripts', 'fleet'), { recursive: true })
  writeFileSync(
    path.join(tmpRoot, 'scripts', 'fleet', 'paths.mts'),
    "export const REPO_ROOT = '/tmp/fake'\n",
  )
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('paths-mts-inherit-guard', () => {
  test('allows non-Edit/Write tools', () => {
    const r = runHook({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    })
    assert.equal(r.code, 0)
  })

  test('allows Edit/Write to non-paths.mts files', () => {
    const r = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(tmpRoot, 'scripts', 'foo.mts'),
        new_string: '// whatever',
      },
    })
    assert.equal(r.code, 0)
  })

  test('allows repo-root scripts/fleet/paths.mts (no ancestor)', () => {
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(tmpRoot, 'scripts', 'fleet', 'paths.mts'),
        content: "export const X = 'no inheritance needed at root'\n",
      },
    })
    assert.equal(r.code, 0)
  })

  test('blocks sub-package paths.mts without export *', () => {
    mkdirSync(path.join(tmpRoot, 'packages', 'foo', 'scripts'), {
      recursive: true,
    })
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(
          tmpRoot,
          'packages',
          'foo',
          'scripts',
          'paths.mts',
        ),
        content: "export const REDERIVED = 'wrong'\n",
      },
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /paths-mts-inherit-guard/)
    assert.match(r.stderr, /export \* from/)
  })

  test('discovers the ancestor at scripts/fleet/paths.mts (post-segmentation)', () => {
    // Regression: before findAncestorPathsMts learned the scripts/fleet/
    // location, a sub-package whose only ancestor lives at
    // scripts/fleet/paths.mts (the segmented repo-root module) was wrongly
    // treated as having NO ancestor → silently exempt. The block must fire,
    // and the suggested re-export must point at the fleet location.
    mkdirSync(path.join(tmpRoot, 'packages', 'seg', 'scripts'), {
      recursive: true,
    })
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(
          tmpRoot,
          'packages',
          'seg',
          'scripts',
          'paths.mts',
        ),
        content: "export const REDERIVED = 'wrong'\n",
      },
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /scripts\/fleet\/paths\.mts/)
  })

  test('allows sub-package paths.mts WITH export *', () => {
    mkdirSync(path.join(tmpRoot, 'packages', 'foo', 'scripts'), {
      recursive: true,
    })
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(
          tmpRoot,
          'packages',
          'foo',
          'scripts',
          'paths.mts',
        ),
        content:
          "export * from '../../../scripts/fleet/paths.mts'\nexport const FOO_DIST = '/x'\n",
      },
    })
    assert.equal(r.code, 0)
  })

  test('allows Edit when existing file already has export *', () => {
    mkdirSync(path.join(tmpRoot, 'packages', 'bar', 'scripts'), {
      recursive: true,
    })
    const subPath = path.join(
      tmpRoot,
      'packages',
      'bar',
      'scripts',
      'paths.mts',
    )
    writeFileSync(
      subPath,
      "export * from '../../../scripts/fleet/paths.mts'\nexport const OLD = '/x'\n",
    )
    const r = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: subPath,
        // The diff doesn't touch the export * line, just adds an
        // additional const below it.
        new_string: "export const BAR_DIST = '/y'\n",
      },
    })
    assert.equal(r.code, 0)
  })

  test('allows paths.cts variant (and the pre-segmentation export * target)', () => {
    // The guard checks the textual export * line; it does NOT resolve the
    // target to disk. So a sub-package re-exporting the OLD pre-segmentation
    // path string still satisfies inheritance — un-migrated repos aren't
    // suddenly blocked. (The on-disk ancestor here is scripts/fleet/paths.mts.)
    mkdirSync(path.join(tmpRoot, 'packages', 'cjs', 'scripts'), {
      recursive: true,
    })
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(
          tmpRoot,
          'packages',
          'cjs',
          'scripts',
          'paths.cts',
        ),
        content: "export * from '../../../scripts/paths.mts'\n",
      },
    })
    assert.equal(r.code, 0)
  })

  test('fails open on invalid JSON', () => {
    const r = spawnSync('node', [HOOK], {
      input: 'not json',
    })
    assert.equal(r.status, 0)
  })

  test('fails open on empty stdin', () => {
    const r = spawnSync('node', [HOOK], {
      input: '',
    })
    assert.equal(r.status, 0)
  })

  test('ignores file paths outside a scripts/ dir', () => {
    // A `paths.mts` not under `scripts/` is some other file with the
    // same name; not our concern.
    mkdirSync(path.join(tmpRoot, 'lib'), { recursive: true })
    const r = runHook({
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(tmpRoot, 'lib', 'paths.mts'),
        content: "export const X = 'not a scripts paths.mts'\n",
      },
    })
    assert.equal(r.code, 0)
  })
})
