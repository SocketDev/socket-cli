// node --test specs for scripts/install-git-hooks.mts.
//
// The installer is invoked from `prepare` at `pnpm install` time. Its
// job: set `core.hooksPath = .git-hooks` in the local git config when
// run inside a git checkout that has a `.git-hooks/` dir. Replaces
// husky's auto-install side effect with a 60-LOC dependency-free
// script.
//
// Each test spawns the installer in a tmpdir with a controlled
// .git/ + .git-hooks/ layout, then inspects the resulting
// core.hooksPath value via `git config`. Idempotency is verified by
// running the installer twice and confirming the second run is silent.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(here, '..', 'install-git-hooks.mts')

function makeTmpRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'install-git-hooks-test-'))
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { force: true, recursive: true })
    },
  }
}

// Initialize an empty git repo at dir. Uses `git init` so the .git
// directory has the same shape git itself expects (objects/, refs/,
// HEAD, …). Inheriting the user's git config could pollute the local
// `core.hooksPath` we're trying to inspect, so the test config sets a
// minimal identity and disables `core.hooksPath` inheritance via
// --local writes only.
function gitInit(dir: string): void {
  const r = spawnSync('git', ['init', '--quiet', dir], { encoding: 'utf8' })
  assert.strictEqual(r.status, 0, `git init failed: ${r.stderr}`)
}

function readLocalConfig(dir: string, key: string): string | undefined {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', '--get', key], {
    encoding: 'utf8',
  })
  return r.status === 0 ? r.stdout.trim() : undefined
}

function runInstaller(dir: string): { code: number; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
  })
  return { code: r.status ?? 0, stderr: r.stderr ?? '' }
}

test('install-git-hooks: sets core.hooksPath when .git + .git-hooks both present', () => {
  const { dir, cleanup } = makeTmpRepo()
  try {
    gitInit(dir)
    mkdirSync(path.join(dir, '.git-hooks'), { recursive: true })
    writeFileSync(path.join(dir, '.git-hooks', 'pre-commit'), '#!/bin/sh\nexit 0\n')

    const result = runInstaller(dir)
    assert.strictEqual(result.code, 0, `installer stderr: ${result.stderr}`)
    assert.strictEqual(readLocalConfig(dir, 'core.hooksPath'), '.git-hooks')
  } finally {
    cleanup()
  }
})

test('install-git-hooks: idempotent — second run is a silent no-op', () => {
  const { dir, cleanup } = makeTmpRepo()
  try {
    gitInit(dir)
    mkdirSync(path.join(dir, '.git-hooks'), { recursive: true })

    const first = runInstaller(dir)
    assert.strictEqual(first.code, 0)
    assert.strictEqual(readLocalConfig(dir, 'core.hooksPath'), '.git-hooks')

    const second = runInstaller(dir)
    assert.strictEqual(second.code, 0)
    // Still set, still pointing at .git-hooks.
    assert.strictEqual(readLocalConfig(dir, 'core.hooksPath'), '.git-hooks')
    // Second run produced no stderr (truly silent on the no-op path).
    assert.strictEqual(second.stderr.trim(), '')
  } finally {
    cleanup()
  }
})

test('install-git-hooks: skips when .git dir is absent (e.g. tarball install)', () => {
  const { dir, cleanup } = makeTmpRepo()
  try {
    // No `git init` — just create .git-hooks/ alone.
    mkdirSync(path.join(dir, '.git-hooks'), { recursive: true })

    const result = runInstaller(dir)
    assert.strictEqual(result.code, 0)
    // No config to inspect — the dir isn't a git repo.
    assert.strictEqual(readLocalConfig(dir, 'core.hooksPath'), undefined)
  } finally {
    cleanup()
  }
})

test('install-git-hooks: skips when .git-hooks dir is absent (pre-cascade state)', () => {
  const { dir, cleanup } = makeTmpRepo()
  try {
    gitInit(dir)
    // No .git-hooks dir.

    const result = runInstaller(dir)
    assert.strictEqual(result.code, 0)
    // Installer bowed out before writing config.
    assert.strictEqual(readLocalConfig(dir, 'core.hooksPath'), undefined)
  } finally {
    cleanup()
  }
})
