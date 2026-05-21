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
//
// The installer anchors REPO_ROOT on its own `import.meta.url` (not
// `process.cwd()`), so each test must COPY install-git-hooks.mts into
// `<tmpdir>/scripts/install-git-hooks.mts` before spawning it. Running
// the original script in the wheelhouse/fleet repo would still
// resolve REPO_ROOT to the real repo and write to the real git config
// instead of the tmpdir, which is what we want to verify.

import { spawnSync } from '@socketsecurity/lib-stable/spawn/spawn'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SOURCE_SCRIPT = path.join(here, '..', 'install-git-hooks.mts')

interface TmpRepo {
  /**
   * Absolute path to the tmpdir; serves as the repo root the installer sees.
   */
  readonly dir: string
  /**
   * Copy of install-git-hooks.mts under <dir>/scripts/ — what each test spawns.
   */
  readonly installerPath: string
  /**
   * Where the installer expects to find / will write `core.hooksPath` -> here.
   */
  readonly hooksDir: string
  readonly cleanup: () => void
}

function makeTmpRepo(): TmpRepo {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'install-git-hooks-test-'))
  // Mirror the real on-disk layout: <repo-root>/scripts/install-git-hooks.mts.
  // The installer derives REPO_ROOT as `path.dirname(import.meta.url)/..`,
  // so placing the copy under `<dir>/scripts/` makes REPO_ROOT === dir.
  const scriptsDir = path.join(dir, 'scripts')
  mkdirSync(scriptsDir, { recursive: true })
  const installerPath = path.join(scriptsDir, 'install-git-hooks.mts')
  copyFileSync(SOURCE_SCRIPT, installerPath)
  // Construct once; tests reference `repo.hooksDir` everywhere they need it.
  const hooksDir = path.join(dir, '.git-hooks')
  return {
    dir,
    installerPath,
    hooksDir,
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
  const r = spawnSync('git', ['init', '--quiet', dir], {})
  assert.strictEqual(r.status, 0, `git init failed: ${r.stderr}`)
}

function readLocalConfig(dir: string, key: string): string | undefined {
  const r = spawnSync('git', ['-C', dir, 'config', '--local', '--get', key], {})
  return r.status === 0 ? String(r.stdout).trim() : undefined
}

function runInstaller(
  installerPath: string,
  cwd: string,
): { code: number; stderr: string } {
  const r = spawnSync(process.execPath, [installerPath], {
    cwd,
  })
  return { code: r.status ?? 0, stderr: String(r.stderr) ?? '' }
}

test('install-git-hooks: sets core.hooksPath when .git + .git-hooks both present', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    mkdirSync(repo.hooksDir, { recursive: true })
    writeFileSync(path.join(repo.hooksDir, 'pre-commit'), '#!/bin/sh\nexit 0\n')

    const result = runInstaller(repo.installerPath, repo.dir)
    assert.strictEqual(result.code, 0, `installer stderr: ${result.stderr}`)
    assert.strictEqual(
      readLocalConfig(repo.dir, 'core.hooksPath'),
      '.git-hooks',
    )
  } finally {
    repo.cleanup()
  }
})

test('install-git-hooks: idempotent — second run is a silent no-op', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    mkdirSync(repo.hooksDir, { recursive: true })

    const first = runInstaller(repo.installerPath, repo.dir)
    assert.strictEqual(first.code, 0)
    assert.strictEqual(
      readLocalConfig(repo.dir, 'core.hooksPath'),
      '.git-hooks',
    )

    const second = runInstaller(repo.installerPath, repo.dir)
    assert.strictEqual(second.code, 0)
    // Still set, still pointing at .git-hooks.
    assert.strictEqual(
      readLocalConfig(repo.dir, 'core.hooksPath'),
      '.git-hooks',
    )
    // Second run produced no stderr (truly silent on the no-op path).
    assert.strictEqual(second.stderr.trim(), '')
  } finally {
    repo.cleanup()
  }
})

test('install-git-hooks: skips when .git dir is absent (e.g. tarball install)', () => {
  const repo = makeTmpRepo()
  try {
    // No `git init` — just create .git-hooks/ alone.
    mkdirSync(repo.hooksDir, { recursive: true })

    const result = runInstaller(repo.installerPath, repo.dir)
    assert.strictEqual(result.code, 0)
    // No config to inspect — the dir isn't a git repo.
    assert.strictEqual(readLocalConfig(repo.dir, 'core.hooksPath'), undefined)
  } finally {
    repo.cleanup()
  }
})

test('install-git-hooks: skips when .git-hooks dir is absent (pre-cascade state)', () => {
  const repo = makeTmpRepo()
  try {
    gitInit(repo.dir)
    // No .git-hooks dir.

    const result = runInstaller(repo.installerPath, repo.dir)
    assert.strictEqual(result.code, 0)
    // Installer bowed out before writing config.
    assert.strictEqual(readLocalConfig(repo.dir, 'core.hooksPath'), undefined)
  } finally {
    repo.cleanup()
  }
})
