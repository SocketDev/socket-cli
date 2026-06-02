#!/usr/bin/env node
/**
 * @file Configure git to use .git-hooks/fleet/ as the local hooks dir. Replaces
 *   husky — same end-state (committed hook source + auto-install on `pnpm
 *   install`), one fewer dependency. Idempotent: re-running is a no-op when
 *   core.hooksPath already points at .git-hooks/fleet. Safe to invoke from
 *   `prepare`. Skipped when:
 *
 *   - Not inside a git repo (e.g. running in a tarball install).
 *   - .git-hooks/fleet/ doesn't exist (e.g. the template scaffold hasn't been
 *     cascaded into this repo yet).
 *
 *   `.git-hooks/` carries two subdirs:
 *
 *   - `fleet/` — hook entry points (commit-msg / pre-commit / pre-push +
 *     `.mts` implementations + tests). Git invokes scripts here as
 *     `<hook-name>` (e.g. `.git-hooks/fleet/pre-commit`).
 *   - `_shared/` — helpers consumed BY the entry points (helpers.mts,
 *     resolve-node.sh). Never invoked by git directly.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = '.git-hooks/fleet'

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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (current.status === 0 && String(current.stdout).trim() === HOOKS_DIR) {
    return
  }

  const set = spawnSync(
    'git',
    ['config', '--local', 'core.hooksPath', HOOKS_DIR],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  if (set.status !== 0) {
    process.stderr.write(
      `[install-git-hooks] failed to set core.hooksPath: ${String(set.stderr).trim()}\n`,
    )
    process.exitCode = 1
  }
}

main()
