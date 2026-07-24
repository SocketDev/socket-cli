#!/usr/bin/env node
// Claude Code PreToolUse hook — commit-size-nudge.
//
// Reminder (NOT a block) on `git commit` when the STAGED diff is large. Fleet
// commits stay small — one logical change, ~200 changed lines of authored
// source — so they land cleanly onto local main without cross-worktree
// collisions and read like a small reviewable PR. A large staged set is the
// signal to split into surgical commits (`git commit -o <file>`), each its own
// logical change.
//
// This is the commit-time twin of `small-pr-nudge`: both target ~200 authored
// lines. The fleet direct-pushes to main, so the size discipline actually bites
// here, at commit time.
//
// Generated / mechanical churn does NOT count toward the ceiling (a lockfile
// regen, a rebuilt hook bundle, or a generated dist/ tree is legitimately
// large); those pathspecs are excluded from the shortstat. A cascade
// (`FLEET_SYNC=1`) is exempt outright — a cascade commit is a whole slice by
// design.
//
// Detection of `git commit` is the shared `isGitCommit` parse (tolerates
// `git -c k=v` prefixes); the size is `git diff --cached --shortstat` scoped by
// exclude pathspecs, so `&&` chains and quoting in the command don't matter.

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isGitCommit } from '../_shared/commit-command.mts'
import { bashGuard, defineHook, notify, runHook } from '../_shared/guard.mts'
import { spawnTimeoutMs } from '../_shared/spawn-timeout.mts'
import { resolveProjectDir } from '../_shared/project-dir.mts'

// Fleet doctrine: one logical change, ~200 changed lines of authored source.
const COMMIT_SIZE_LINES = 200

/**
 * The changed-line + file totals of the staged diff. Undefined when the diff
 * can't be computed (not a git repo, git errored) — the hook fails open.
 */
export interface DiffSize {
  readonly files: number
  readonly lines: number
}

/**
 * True when a path's churn is generated/mechanical and shouldn't count toward
 * the authored size — a regen of any of these is legitimately large and not a
 * "split me" signal. Matched by basename + directory segment (robust to root or
 * nested location, which a `**`-pathspec is not).
 */
export function isGeneratedPath(filePath: string): boolean {
  const normalizedFilePath = normalizePath(filePath)
  const base = normalizedFilePath.split('/').pop() ?? filePath
  return (
    base === 'package-lock.json' ||
    base === 'pnpm-lock.yaml' ||
    base.endsWith('.snap') ||
    /\.min\.[^/]+$/.test(base) ||
    (base === 'bundle.cjs' && normalizedFilePath.includes('_dispatch/')) ||
    /(?:^|\/)(?:build|dist)\//.test(normalizedFilePath)
  )
}

/**
 * Parse `git diff --cached --numstat` into a {@link DiffSize}, summing
 * `added + deleted` across files whose path is not generated. Each line is
 * `<added>\t<deleted>\t<path>`; a binary file shows `-` for both counts.
 */
export function parseNumstat(numstat: string): DiffSize {
  let files = 0
  let lines = 0
  const lineList = numstat.split('\n')
  for (let i = 0, { length } = lineList; i < length; i += 1) {
    const line = lineList[i]!
    // `<added>\t<deleted>\t<path>`; a binary file shows `-` for both counts —
    // group 1 is added, group 2 is deleted, group 3 is the path.
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line)
    if (!m || isGeneratedPath(m[3]!)) {
      continue
    }
    files += 1
    lines +=
      (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]))
  }
  return { files, lines }
}

/**
 * The size of the STAGED diff (`git diff --cached --numstat`) in `cwd`, with
 * generated/mechanical paths excluded so only authored source counts. Returns
 * undefined when the diff can't be computed (fails open).
 */
export function stagedDiffSize(cwd: string): DiffSize | undefined {
  const r = spawnSync('git', ['diff', '--cached', '--numstat'], {
    cwd,
    timeout: spawnTimeoutMs(5000),
  })
  if (r.status !== 0) {
    return undefined
  }
  return parseNumstat(String(r.stdout))
}

export const hook = defineHook({
  check: bashGuard((command, payload) => {
    if (!isGitCommit(command)) {
      return undefined
    }
    // A cascade commits a whole slice by design — exempt.
    if (process.env['FLEET_SYNC'] === '1') {
      return undefined
    }
    const cwd = resolveProjectDir(payload.cwd)
    const size = stagedDiffSize(cwd)
    if (!size || size.lines <= COMMIT_SIZE_LINES) {
      return undefined
    }
    return notify(
      [
        '[commit-size-nudge] This commit is large',
        '',
        `  Staged: ${size.lines} changed lines across ${size.files} file(s) (generated/lockfile churn excluded).`,
        `  Fleet commits stay small — one logical change, ~${COMMIT_SIZE_LINES} authored lines — so they land`,
        '  cleanly onto local main without cross-worktree collisions.',
        '',
        '  Split into surgical commits, each its own logical change:',
        '',
        '    git commit -o <file> -o <file> -m "…"',
        '',
        '  Reminder-only; not a block. A cascade (FLEET_SYNC=1) is exempt.',
        '',
      ].join('\n'),
    )
  }),
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
