#!/usr/bin/env node
/*
 * Refreshing-history runner.
 *
 * Squashes a Socket fleet repo's default branch to a single signed "Initial
 * commit", refreshes deps, formats, runs the check pass, and force-pushes.
 * Operates in a sibling worktree; the primary checkout is never disturbed.
 *
 * Phases match the table in SKILL.md:
 *
 * 1. Pre-flight — resolve default branch, fetch, capture orig HEAD/count
 * 2. Freeze boundary — resolve the newest published-release anchor (if any);
 *    a repo with no boundary squashes full-root as below, a repo WITH one
 *    collapses only the tail above it (never rewriting the release commit)
 * 3. Worktree — git worktree add -b chore/squash-and-refresh ../<repo>-squash
 * 4. Backup — push <orig-head>:refs/heads/backup-<ts> before any destruction
 * 5. Squash — full-root: git commit-tree -S → reset; verify count == 1, sig
 *    == G. Tail (boundary present): fresh commit on the boundary, never an
 *    amend of it
 * 6. Integrity — diff vs orig must be empty; tail mode also re-asserts the
 *    boundary itself is untouched and still reachable
 * 7. Refresh — pnpm run update / install / fix --all / check --all
 * 8. Amend — fold any post-refresh changes into the squash commit (a fresh
 *    commit instead, in the no-op tail case, so the boundary is never amended)
 * 9. Force-push — git push --force --no-verify origin HEAD:$BASE
 * 10. Cleanup — git worktree remove + branch -D
 * 11. Report — new SHA, backup ref, recovery one-liner
 *
 * Usage: node .claude/skills/refreshing-history/run.mts /path/to/<repo>
 */
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

const logger = getDefaultLogger()
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { isError } from '@socketsecurity/lib/errors/predicates'

import { resolveDefaultBranch } from '../_shared/scripts/git-default-branch.mts'
// Shared run/timestamp/header helpers — one owner, not a per-runner copy.
import { header, run, timestamp } from '../_shared/scripts/run-helpers.mts'
import {
  checkNotShallowClone,
  resolveFreezeBoundaryForRepo,
} from '../squashing-history/run-guards.mts'
// Shared squash engine — the reset/amend/count/integrity dance lives in
// squashing-history; refreshing-history layers dep-refresh + sign on top.
import {
  assertBoundaryIntact,
  squashSingleCommit,
} from '../squashing-history/run.mts'

export { header, run, timestamp }

async function main(): Promise<number> {
  const src = process.argv[2]
  if (!src) {
    logger.error('usage: node run.mts <repo-path>')
    return 2
  }

  // Verify it's a real git checkout — trust git, not fs probes (cross-platform).
  try {
    await run('git', ['rev-parse', '--git-dir'], src)
  } catch {
    logger.error(`error: ${src} is not a git checkout`)
    return 2
  }

  const repoName = path.basename(src)
  const worktree = `${src}-squash`
  const ts = timestamp()
  const backup = `backup-${ts}`
  const squashBranch = 'chore/squash-and-refresh'

  logger.info('============================================================')
  logger.info(`  refreshing-history: ${repoName}`)
  logger.info('============================================================')

  // Phase 1 — pre-flight.
  const base = await resolveDefaultBranch({ cwd: src })
  header('default branch', base)
  await run('git', ['fetch', 'origin', base], src)

  const shallowExit = await checkNotShallowClone({ base, src })
  if (shallowExit !== undefined) {
    return shallowExit
  }

  const origHead = (await run('git', ['rev-parse', `origin/${base}`], src))
    .stdout
  const origCount = (
    await run('git', ['rev-list', '--count', `origin/${base}`], src)
  ).stdout
  header(`original ${base}`, `${origHead} (${origCount} commits)`)

  // Freeze boundary — this runner is a SECOND full-root squash path with its
  // own force-push, so it carries the same published-release safeguard as
  // squashing-history: a repo with a resolved boundary never gets its root
  // rewritten here either. `refuseMessage` means the registry confirms a real
  // release with no safe anchor to freeze at — refuse loudly rather than
  // silently full-flattening it.
  const freeze = await resolveFreezeBoundaryForRepo({ src, tip: origHead })
  if (freeze.refuseMessage !== undefined) {
    logger.error(`error: ${freeze.refuseMessage}`)
    return 2
  }
  const { boundary } = freeze
  const boundaryCount =
    boundary !== undefined
      ? (
          await run(
            'git',
            ['rev-list', '--count', `${boundary}..${origHead}`],
            src,
          )
        ).stdout
      : undefined
  if (boundary !== undefined) {
    header(
      'frozen release boundary',
      `${boundary} (${boundaryCount} commits past it)`,
    )
  }

  // Worktree, clean any stale state from prior runs.
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })
  await run(
    'git',
    ['worktree', 'add', '-b', squashBranch, worktree, `origin/${base}`],
    src,
  )

  // Remote backup ref, before any destructive rewrite.
  logger.info(
    `  pushing remote backup ref: refs/heads/${backup} -> ${origHead}`,
  )
  // --no-verify: the worktree has no node_modules, so the repo's git pre-push
  // hook (which imports @socketsecurity/lib-stable) cannot load. A backup ref
  // carries only existing, already-validated history; nothing new to verify.
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${origHead}:refs/heads/${backup}`],
    worktree,
  )

  // Squash + integrity run through the shared squashing-history engine.
  // sign: true asserts the %G? == 'G' that required_signatures branch
  // protection demands; a tree mismatch is a HARD process.exit(1) in the
  // engine. No boundary: full-root amend, matching the historical behavior.
  // A boundary present: a FRESH commit on it (never amend — that would
  // rewrite the published-release commit), UNLESS there are zero commits
  // past the boundary already (origHead == boundary), in which case there is
  // nothing to squash — skip straight to the refresh phase on origHead.
  const boundaryIsTip = boundary !== undefined && boundaryCount === '0'
  let newSha: string
  if (boundaryIsTip) {
    newSha = origHead
    logger.info(
      '  already squashed past the frozen release — nothing to collapse before refresh',
    )
  } else {
    const result = await squashSingleCommit({
      amend: boundary === undefined,
      message:
        boundary === undefined
          ? 'Initial commit'
          : 'chore: squash unreleased history',
      origHead,
      resetTo: boundary,
      sign: true,
      worktree,
    })
    newSha = result.newHead
    logger.success(
      `squashed ${origCount} commits → 1 signed commit (${newSha})`,
    )
    logger.success(`integrity: post-squash tree == origin/${base} tree`)
    if (boundary !== undefined) {
      await assertBoundaryIntact(worktree, boundary)
    }
  }

  // Refresh deps + format + check.
  const refreshSteps: ReadonlyArray<
    readonly [label: string, args: readonly string[]]
  > = [
    ['pnpm run update', ['run', 'update']],
    ['pnpm install', ['install']],
    ['pnpm run fix --all', ['run', 'fix', '--all']],
    ['pnpm run check --all', ['run', 'check', '--all']],
  ]
  for (const [label, args] of refreshSteps) {
    logger.info(`  ${label}...`)
    const result = await run('pnpm', args, worktree, { allowFailure: true })
    if (result.stderr) {
      // Soft warning — refresh failures are non-fatal; the amend rolls
      // up whatever did land.
      logger.warn(`${label} non-zero`)
    }
  }

  // Fold the refresh output into the squash commit — the umbrella "no -A"
  // rule applies to the primary checkout; this is a transient skill-owned
  // worktree on a branch the skill just created, and refresh outputs aren't
  // enumerable in advance, so a scoped -A is the right call here.
  await run('git', ['add', '-A'], worktree)
  const stagedFiles = (
    await run('git', ['diff', '--cached', '--name-only'], worktree)
  ).stdout
  if (stagedFiles.length > 0) {
    if (boundaryIsTip) {
      // No squash commit was made above (HEAD is still the frozen boundary
      // itself) — a FRESH commit, never an amend of the boundary.
      logger.info('  committing refresh changes on top of the frozen release')
      await run(
        'git',
        ['commit', '--no-verify', '-m', 'chore: refresh dependencies'],
        worktree,
      )
    } else {
      logger.info('  amending refresh changes into the squash commit')
      await run(
        'git',
        ['commit', '--amend', '--no-edit', '--no-verify'],
        worktree,
      )
    }
  } else {
    logger.info('  no post-squash changes to amend')
  }
  if (boundary !== undefined) {
    await assertBoundaryIntact(worktree, boundary)
  }

  // Force-push. Leased against origHead — this runner now runs on RELEASED
  // repos too (the freeze-boundary gate above), so a bare --force carries the
  // same racing-push risk squashTailMode's lease already guards against.
  logger.info(`  force-pushing to ${base}...`)
  await run(
    'git',
    [
      'push',
      '--no-verify',
      `--force-with-lease=${base}:${origHead}`,
      'origin',
      `HEAD:${base}`,
    ],
    worktree,
  )
  const newHead = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout

  // Cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  // Report.
  logger.log('')
  logger.success(`${repoName} refreshed`)
  logger.info(`    new ${base}:   ${newHead}`)
  logger.info(`    backup ref: refs/heads/${backup} -> ${origHead}`)
  logger.info(
    `    recover:    git fetch origin ${backup} && git push --force origin FETCH_HEAD:${base}`,
  )
  return 0
}

main()
  .then(code => {
    process.exitCode = code
  })
  .catch((e: unknown) => {
    const message = isError(e) ? e.message : errorMessage(e)
    logger.error(`refreshing-history failed: ${message}`)
    process.exitCode = 1
  })
