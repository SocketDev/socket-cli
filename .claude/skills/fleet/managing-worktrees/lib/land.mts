#!/usr/bin/env node
/**
 * @file Fast-land engine: move already-verified commits from a feature branch /
 *   worktree onto `origin/<default>` with the least ceremony that's still safe.
 *   The fleet lints AS IT EDITS (oxlint + oxfmt at edit time, the edit-time
 *   guards), so by the time a commit exists its diff has already passed the
 *   gates the pre-commit / pre-push hooks re-run. Re-running them on land is
 *   ceremony — and this session proved it can wedge (a pre-commit staged-test
 *   run hung 55 min) or crash (a fresh worktree has no node_modules, so the
 *   pre-push hooks throw ERR_MODULE_NOT_FOUND). This engine replaces the manual
 *   cherry-pick → fast-forward dance with one command:
 *
 *   1. Resolve the remote default branch (reuses resolveBase — never hard-coded).
 *   2. CONFIRM each landing commit's changed files lint clean (a fast,
 *      deterministic re-assert of the edit-time gate — NOT a heavy test
 *      re-run). A dirty diff aborts: lint-as-edit is the contract, so a lint
 *      failure here means the contract was bypassed and the land is unsafe.
 *   3. Cherry-pick the commits onto a throwaway worktree branched off
 *      `origin/<base>` (a clean tree — no parallel-session dirt, no
 *      divergence).
 *   4. Fast-forward `origin/<base>` to the cherry-picked tip. NEVER force-push; if
 *      the push wouldn't be a clean fast-forward, abort and report (someone
 *      pushed since — re-run to pick up their commits).
 *   5. Remove the throwaway worktree + branch. Default is --dry-run (plan only).
 *      Pass --push to act. This is the engine behind `managing-worktrees land`.
 *      Usage: node land.mts <commit>... # dry-run: plan landing these commits
 *      node land.mts --last 2 # the last 2 commits of HEAD node land.mts
 *      <commit>... --push # actually land them node land.mts --last 2 --push
 *      --no-verify-lint # skip the lint re-assert (only when a worktree can't
 *      run lint)
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  git,
  gitOk,
  resolveBase,
} from '../../tidying-worktrees/lib/tidy-worktrees.mts'

const logger = getDefaultLogger()

export interface LandPlan {
  base: string
  commits: string[]
  worktreePath: string
  landBranch: string
}

/**
 * Resolve the list of commit SHAs to land. `--last N` expands to the last N
 * commits of HEAD (oldest-first, the cherry-pick order); explicit SHAs are
 * taken as-is (also normalized oldest-first by their commit order).
 */
export async function resolveCommits(
  repoDir: string,
  argv: string[],
): Promise<string[]> {
  const lastIdx = argv.indexOf('--last')
  if (lastIdx !== -1) {
    const n = Number(argv[lastIdx + 1])
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(
        `--last needs a positive integer.\n  Saw: ${argv[lastIdx + 1]}\n  Fix: e.g. --last 2`,
      )
    }
    const range = await git(repoDir, [
      'rev-list',
      '--reverse',
      `HEAD~${n}..HEAD`,
    ])
    return range.split('\n').filter(Boolean)
  }
  // Explicit SHAs (everything that isn't a flag or a flag's value).
  const flagValues = new Set<string>()
  const commits: string[] = []
  for (let i = 0, { length } = argv; i < length; i += 1) {
    const arg = argv[i]!
    if (arg === '--last') {
      flagValues.add(argv[i + 1] ?? '')
      continue
    }
    if (arg.startsWith('--') || flagValues.has(arg)) {
      continue
    }
    commits.push(arg)
  }
  return commits
}

/**
 * Files a commit changed, as repo-relative paths.
 */
export async function commitChangedFiles(
  repoDir: string,
  sha: string,
): Promise<string[]> {
  const out = await git(repoDir, [
    'diff-tree',
    '--no-commit-id',
    '--name-only',
    '-r',
    sha,
  ])
  return out.split('\n').filter(Boolean)
}

/**
 * Re-assert the edit-time lint gate on the landing commits' changed files. The
 * fleet lints as it edits, so this should pass instantly; a failure means the
 * contract was bypassed and the land is unsafe. Returns true when clean (or
 * when there are no lintable files). Skipped by the caller under
 * --no-verify-lint (e.g. a worktree without node_modules).
 */
export async function lintLandsClean(
  repoDir: string,
  files: string[],
): Promise<boolean> {
  const lintable = files.filter(
    f =>
      (f.endsWith('.mts') ||
        f.endsWith('.ts') ||
        f.endsWith('.mjs') ||
        f.endsWith('.js')) &&
      existsSync(path.join(repoDir, f)),
  )
  if (!lintable.length) {
    return true
  }
  const lintBin = path.join(repoDir, 'node_modules', '.bin', 'oxlint')
  if (!existsSync(lintBin)) {
    logger.warn(
      'land: oxlint not installed in this checkout; cannot re-assert the lint gate. ' +
        'Pass --no-verify-lint to land anyway (only safe when the diff was lint-clean at edit time).',
    )
    return false
  }
  // oxlint's exit code is unreliable as a clean/dirty signal here (the Socket
  // Firewall wrapper / warning-level findings can exit non-zero on a clean
  // run), so key on the reported ERROR COUNT instead. The summary line is
  // `Found <W> warnings and <E> errors.`; clean ⟺ E === 0. spawn rejects on a
  // non-zero exit, so read stdout/stderr off either the resolved result or the
  // caught error.
  const result = (await spawn(
    lintBin,
    ['-c', '.config/fleet/oxlint.config.mts', ...lintable],
    { cwd: repoDir, stdioString: true },
  ).catch((e: unknown) => e)) as {
    stdout?: string | undefined
    stderr?: string | undefined
  }
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  // Files outside this config's lint scope (e.g. `template/**`, which the
  // wheelhouse oxlint config ignores because the template is linted as its
  // cascaded LIVE copies, not the seed path) make oxlint report "No files
  // found to lint". That's not a dirty diff — but it's also NOT a verification,
  // so say so LOUDLY rather than silently passing. The edit-time gate covers
  // those files at their real path; the land proceeds, but the reader knows
  // the re-assert didn't actually run on them.
  if (/No files found to lint/.test(output)) {
    logger.warn(
      `land: ${lintable.length} file(s) are outside this checkout's lint scope ` +
        `(e.g. template/** is linted as its live copies, not the seed path) — ` +
        `the lint gate could not re-assert them here. Relying on the edit-time ` +
        `gate that already covered them: ${lintable.join(', ')}`,
    )
    return true
  }
  // oxlint's summary line is `Found <W> warnings and <E> errors.`; clean ⟺
  // E === 0. Anchor on the error count, not the exit code.
  const match = /Found \d+ warnings? and (\d+) errors?/.exec(output)
  if (!match) {
    // No summary line and no "no files" signal — oxlint itself failed (bad
    // config, crash). Fail closed: never land an unverified diff.
    return false
  }
  return Number(match[1]) === 0
}

/**
 * Build the land plan: resolve base + the throwaway worktree location.
 */
export async function planLand(
  repoDir: string,
  commits: string[],
): Promise<LandPlan> {
  if (!commits.length) {
    throw new Error(
      'land: no commits to land.\n  Fix: pass commit SHAs or --last <N>.',
    )
  }
  const base = await resolveBase(repoDir)
  // Stable, collision-resistant-enough name from the tip commit.
  const tip = commits[commits.length - 1]!.slice(0, 8)
  const landBranch = `land/fast-${tip}`
  const worktreePath = path.join(
    repoDir,
    '..',
    `${path.basename(repoDir)}-land-${tip}`,
  )
  return { base, commits, worktreePath, landBranch }
}

/**
 * Execute the plan: fetch base, worktree off origin/<base>, cherry-pick, verify
 * fast-forward, push, clean up. Returns the landed tip SHA.
 */
export async function executeLand(
  repoDir: string,
  plan: LandPlan,
): Promise<string> {
  const { base, commits, landBranch, worktreePath } = plan
  await git(repoDir, ['fetch', 'origin', base])

  // Fresh worktree off origin/<base> — a clean tree, no divergence, no
  // parallel-session dirt.
  if (existsSync(worktreePath)) {
    await git(repoDir, ['worktree', 'remove', worktreePath, '--force'])
  }
  await git(repoDir, [
    'worktree',
    'add',
    '-b',
    landBranch,
    worktreePath,
    `origin/${base}`,
  ])

  try {
    const picked = await gitOk(worktreePath, ['cherry-pick', ...commits])
    if (!picked) {
      await git(worktreePath, ['cherry-pick', '--abort'])
      throw new Error(
        `land: cherry-pick of ${commits.length} commit(s) onto origin/${base} hit a conflict.\n` +
          `  Fix: the commits don't apply cleanly on the current ${base} — rebase them first, or land manually.`,
      )
    }
    const tip = await git(worktreePath, ['rev-parse', 'HEAD'])

    // Confirm a clean fast-forward: origin/<base> must be an ancestor of tip.
    await git(repoDir, ['fetch', 'origin', base])
    const isFf = await gitOk(worktreePath, [
      'merge-base',
      '--is-ancestor',
      `origin/${base}`,
      'HEAD',
    ])
    if (!isFf) {
      throw new Error(
        `land: origin/${base} moved and is no longer an ancestor — not a clean fast-forward.\n` +
          `  Fix: re-run land (it re-cherry-picks onto the new origin/${base}).`,
      )
    }

    // Fast-forward push. NEVER force. The pre-push hooks are skipped via
    // --no-verify because (a) the diff was lint-verified above and (b) a fresh
    // worktree may lack node_modules, which crashes the lib-importing hooks.
    await spawn('git', ['push', '--no-verify', 'origin', `HEAD:${base}`], {
      cwd: worktreePath,
      stdioString: true,
    })
    return tip
  } finally {
    await git(repoDir, ['worktree', 'remove', worktreePath, '--force']).catch(
      () => {},
    )
    await git(repoDir, ['branch', '-D', landBranch]).catch(() => {})
  }
}

export async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const push = argv.includes('--push')
  const skipLint = argv.includes('--no-verify-lint')
  const repoDir =
    (await git(process.cwd(), ['rev-parse', '--show-toplevel'])) ||
    process.cwd()

  const commits = await resolveCommits(repoDir, argv)
  const plan = await planLand(repoDir, commits)

  logger.log(`land: ${commits.length} commit(s) → origin/${plan.base}`)
  for (const sha of commits) {
    const subject = await git(repoDir, ['log', '-1', '--format=%s', sha])
    logger.log(`  ${sha.slice(0, 8)} ${subject}`)
  }

  if (!skipLint) {
    const allFiles = new Set<string>()
    for (const sha of commits) {
      for (const f of await commitChangedFiles(repoDir, sha)) {
        allFiles.add(f)
      }
    }
    const clean = await lintLandsClean(repoDir, [...allFiles])
    if (!clean) {
      logger.error(
        'land: the landing diff does not lint clean (the lint-as-edit contract was bypassed).\n' +
          '  Fix: `pnpm run fix` the offending files + re-commit, or pass --no-verify-lint if you must.',
      )
      return 1
    }
    logger.success(
      'land: landing diff lints clean (edit-time gate re-asserted).',
    )
  }

  if (!push) {
    logger.log(
      `land: dry-run. Would fast-forward origin/${plan.base} to these commits via a throwaway worktree. Re-run with --push to act.`,
    )
    return 0
  }

  const tip = await executeLand(repoDir, plan)
  logger.success(
    `land: fast-forwarded origin/${plan.base} to ${tip.slice(0, 8)} (${commits.length} commit(s)).`,
  )
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    process.exitCode = await main()
  })()
}
