#!/usr/bin/env node
/*
 * @file Assert no tracked symlink is self-referential or points at an absolute
 *   path inside this repo. A symlink committed as `node_modules → /Users/.../
 *   <repo>/node_modules`, a self-loop, bricks every fresh clone: `pnpm install`
 *   aborts with `ELOOP: too many symbolic links`, and git keeps the symlink
 *   tracked despite `.gitignore`, ignore only applies to UNtracked paths. Root
 *   incident: a cascade swept a stray `node_modules` self-symlink into the tree
 *   via a broad `git add`; it shipped fleet-wide and broke installs until
 *   untracked. The edit-time `no-self-referential-symlink-guard` blocks the
 *   `git add`; this check is the commit-time / `check --all` backstop that
 *   catches one already committed, regardless of how it got staged. Flagged:
 *
 *   - a tracked symlink (git mode 120000) whose target resolves to its own path
 *     (`a/b → /abs/a/b`), OR
 *   - a tracked symlink whose target is an ABSOLUTE path inside this repo
 *     (machine-specific + loop-prone — a symlink into the repo should be
 *     relative), OR
 *   - any tracked `node_modules` (it is gitignored; tracking it at all is the
 *     bug, symlink or not). `--fix` untracks each offender (`git rm --cached`,
 *     via _shared/untrack-offenders.mts) and RE-RUNS the detection — the
 *     re-check, not the executor, decides the exit. Exit: 0 clean / 1 a bad
 *     symlink is tracked (or residual after `--fix`). Detection is shared with
 *     the guard via _shared/self-referential-symlink.mts.
 */

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'
import { classifyTrackedSymlink } from '../lib/self-referential-symlink.mts'
import {
  executeUntrackActions,
  formatUntrackAction,
  planUntrackActions,
} from '../_shared/untrack-offenders.mts'
import type { BadSymlink } from '../lib/self-referential-symlink.mts'
import type { UntrackAction } from '../_shared/untrack-offenders.mts'

const logger = getDefaultLogger()

// `git ls-files --stage` emits `<mode> <oid> <stage>\t<path>`. Mode 120000 is a
// symlink; its blob content is the link target. Read the tree (HEAD/index) so
// the check works even when the working copy has replaced the symlink with a
// real dir, exactly the post-untrack state.
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

// Read a symlink blob's target text from the object store, not the worktree.
function readLinkTarget(repoRoot: string, oid: string): string {
  const r = spawnSync('git', ['cat-file', '-p', oid], {
    cwd: repoRoot,
    stdioString: true,
  })
  return r.status === 0 ? String(r.stdout ?? '').trim() : ''
}

/**
 * The `--fix` plan for bad tracked symlinks: `git rm --cached` per offender —
 * the working-copy entry stays, and .gitignore keeps it untracked afterward.
 * Pure — offender paths in, actions out — so the plan unit-tests without git.
 */
export function planFix(offenderPaths: readonly string[]): UntrackAction[] {
  return planUntrackActions(offenderPaths, 'rm-cached')
}

// Run the detection over the current index state.
function detectOffenders(repoRoot: string): BadSymlink[] {
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
  return bad
}

function main(): void {
  const repoRoot = REPO_ROOT
  const fix = process.argv.includes('--fix')
  let bad = detectOffenders(repoRoot)
  if (bad.length && fix) {
    const offenderPaths: string[] = []
    for (let i = 0, { length } = bad; i < length; i += 1) {
      offenderPaths.push(bad[i]!.linkPath)
    }
    const failures = executeUntrackActions(planFix(offenderPaths), repoRoot)
    for (let i = 0, { length } = failures; i < length; i += 1) {
      const f = failures[i]!
      logger.warn(
        `[tracked-symlinks-are-safe] fix step failed: ${formatUntrackAction(f.action)} — ${f.detail}`,
      )
    }
    // Success is measured by the RE-CHECK, never by executor belief.
    bad = detectOffenders(repoRoot)
  }
  if (bad.length) {
    logger.fail(
      `[tracked-symlinks-are-safe] tracked symlink(s) are self-referential / repo-internal-absolute${fix ? ' after --fix' : ''}:`,
    )
    for (let i = 0, { length } = bad; i < length; i += 1) {
      const b = bad[i]!
      logger.error(`  ✗ ${b.linkPath} → ${b.target}  (${b.reason})`)
    }
    logger.error(
      '  Fix: re-run with `--fix` — each offender is untracked (the real path ' +
        'stays; .gitignore then keeps it untracked) and the detection re-runs. ' +
        'A symlink that must stay should be RELATIVE, never an absolute path ' +
        'inside the repo.',
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
