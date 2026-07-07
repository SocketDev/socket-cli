#!/usr/bin/env node
/*
 * @file Configure git to use .git-hooks/ as the local hooks dir. Replaces
 *   husky — same end-state (committed hook source + auto-install on `pnpm
 *   install`), one fewer dependency. Idempotent: re-running is a no-op when
 *   core.hooksPath already points at .git-hooks. Safe to invoke from
 *   `prepare`. Skipped when:
 *
 *   - Not inside a git repo (e.g. running in a tarball install).
 *   - .git-hooks/ doesn't exist (e.g. the template scaffold hasn't been
 *     cascaded into this repo yet).
 *
 *   `.git-hooks/` root holds a DISPATCHER per hook type (commit-msg /
 *   pre-commit / pre-push / post-commit) — git invokes these as `<hook-name>`.
 *   Each dispatcher runs the fleet hook then the repo hook (Option A), so both
 *   tiers fire under git's single core.hooksPath. Subdirs:
 *   - `fleet/` — fleet hook entry points + `.mts` implementations + tests,
 *     called BY the root dispatchers (not by git directly).
 *   - `repo/` — per-repo hook overrides, called BY the root dispatchers when
 *     present. NOT cascaded (host-owned), so other fleet repos never get them.
 *   - `_shared/` — helpers consumed by the entry points (helpers.mts,
 *     resolve-node.sh). Never invoked by git directly.
 */

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const HOOKS_DIR = '.git-hooks'

// Resolve the repo root by walking up from this script's own location to the
// nearest `package.json` ancestor. Inlined (not imported from paths.mts) on
// purpose: this script runs at `pnpm prepare` time and gets copied/run in
// isolation (tarball installs, the unit-test fixture), so it must stay
// self-contained with no sibling-module dependency. The walk is
// depth-independent — unlike a hardcoded `..` count, it survives the script
// moving between directories (the 73c691d9 scripts-into-fleet/ refactor broke
// the old count).
function resolveRepoRoot(): string {
  let cur = path.dirname(fileURLToPath(import.meta.url))
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  // No package.json ancestor (e.g. a bare copy with no manifest) — fall back to
  // the script's own dir so the existsSync guards below simply skip.
  return path.dirname(fileURLToPath(import.meta.url))
}

const REPO_ROOT = resolveRepoRoot()

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
