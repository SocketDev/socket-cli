#!/usr/bin/env node
/*
 * @file Assert no tracked symlink is self-referential or points at an absolute
 *   path inside this repo. A symlink committed as `node_modules → /Users/.../
 *   <repo>/node_modules` (a self-loop) bricks every fresh clone: `pnpm install`
 *   aborts with `ELOOP: too many symbolic links`, and git keeps the symlink
 *   tracked despite `.gitignore` (ignore only applies to UNtracked paths). Root
 *   incident: a cascade swept a stray `node_modules` self-symlink into the tree
 *   via a broad `git add`; it shipped fleet-wide and broke installs until
 *   untracked. The edit-time `no-self-referential-symlink-guard` blocks the
 *   `git add`; this check is the commit-time / `check --all` backstop that
 *   catches one already committed (regardless of how it got staged). Flagged:
 *
 *   - a tracked symlink (git mode 120000) whose target resolves to its own path
 *     (`a/b → /abs/a/b`), OR
 *   - a tracked symlink whose target is an ABSOLUTE path inside this repo
 *     (machine-specific + loop-prone — a symlink into the repo should be
 *     relative), OR
 *   - any tracked `node_modules` (it is gitignored; tracking it at all is the
 *     bug, symlink or not). Exit: 0 clean / 1 a bad symlink is tracked.
 *     Detection is shared with the guard via
 *     _shared/self-referential-symlink.mts.
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { classifyTrackedSymlink } from '../lib/self-referential-symlink.mts'
import type { BadSymlink } from '../lib/self-referential-symlink.mts'

const logger = getDefaultLogger()

// `git ls-files --stage` emits `<mode> <oid> <stage>\t<path>`. Mode 120000 is a
// symlink; its blob content is the link target. Read the tree (HEAD/index) so
// the check works even when the working copy has replaced the symlink with a
// real dir (exactly the post-untrack state).
function trackedSymlinks(repoRoot: string): Array<{ p: string; oid: string }> {
  const r = spawnSync('git', ['ls-files', '--stage'], {
    cwd: repoRoot,
    stdioString: true,
  })
  if (r.status !== 0) {
    return []
  }
  const out: Array<{ p: string; oid: string }> = []
  const lines = String(r.stdout ?? '').split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (!line.startsWith('120000 ')) {
      continue
    }
    const tab = line.indexOf('\t')
    if (tab === -1) {
      continue
    }
    const oid = line.slice('120000 '.length, line.indexOf(' ', 7))
    out.push({ p: line.slice(tab + 1), oid })
  }
  return out
}

// Read a symlink blob's target text from the object store (not the worktree).
function readLinkTarget(repoRoot: string, oid: string): string {
  const r = spawnSync('git', ['cat-file', '-p', oid], {
    cwd: repoRoot,
    stdioString: true,
  })
  return r.status === 0 ? String(r.stdout ?? '').trim() : ''
}

function main(): void {
  const repoRoot = REPO_ROOT
  const bad: BadSymlink[] = []
  const links = trackedSymlinks(repoRoot)
  for (let i = 0, { length } = links; i < length; i += 1) {
    const { oid, p } = links[i]!
    const target = readLinkTarget(repoRoot, oid)
    const verdict = classifyTrackedSymlink(p, target, repoRoot)
    if (verdict) {
      bad.push(verdict)
    }
  }
  if (bad.length) {
    logger.fail(
      '[tracked-symlinks-are-safe] tracked symlink(s) are self-referential / repo-internal-absolute:',
    )
    for (let i = 0, { length } = bad; i < length; i += 1) {
      const b = bad[i]!
      logger.error(`  ✗ ${b.linkPath} → ${b.target}  (${b.reason})`)
    }
    logger.error(
      '  Untrack it: `git rm --cached <path>` (the real path stays; .gitignore ' +
        'then keeps it untracked). A symlink that must stay should be RELATIVE, ' +
        'never an absolute path inside the repo.',
    )
    process.exitCode = 1
    return
  }
  logger.success(
    '[tracked-symlinks-are-safe] no self-referential / repo-internal-absolute tracked symlinks.',
  )
}

// Anchor on the script location, not cwd (no-process-cwd-in-scripts-hooks).
if (
  path.resolve(process.argv[1] ?? '').endsWith('tracked-symlinks-are-safe.mts')
) {
  main()
}
