#!/usr/bin/env node
/**
 * @fileoverview Configure git to use .git-hooks/ as the local hooks
 * dir. Replaces husky — same end-state (committed hook source +
 * auto-install on `pnpm install`), one fewer dependency.
 *
 * Idempotent: re-running is a no-op when core.hooksPath already
 * points at .git-hooks. Safe to invoke from `prepare`.
 *
 * Skipped when:
 *   - Not inside a git repo (e.g. running in a tarball install).
 *   - .git-hooks/ doesn't exist (e.g. the template scaffold hasn't
 *     been cascaded into this repo yet).
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = '.git-hooks'

// Anchor on the script's own location instead of process.cwd(). The
// `prepare` hook normally runs from the package root, but some
// invocations (e.g. `pnpm --filter <pkg> install` from a parent
// dir, or workspace `prepare` chains) execute with a cwd that
// differs from the script's repo root. `scripts/install-git-hooks.mts`
// is always at `<repo-root>/scripts/install-git-hooks.mts`, so the
// parent of __dirname is the repo root.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function main(): void {
  if (!existsSync(path.join(REPO_ROOT, '.git'))) {
    return
  }
  if (!existsSync(path.join(REPO_ROOT, HOOKS_DIR))) {
    return
  }

  const current = spawnSync(
    'git',
    ['config', '--local', '--get', 'core.hooksPath'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (current.status === 0 && current.stdout.trim() === HOOKS_DIR) {
    return
  }

  const set = spawnSync(
    'git',
    ['config', '--local', 'core.hooksPath', HOOKS_DIR],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (set.status !== 0) {
    process.stderr.write(
      `[install-git-hooks] failed to set core.hooksPath: ${set.stderr.trim()}\n`,
    )
    process.exitCode = 1
  }
}

main()
