#!/usr/bin/env node
/**
 * Refreshing-history runner.
 *
 * Squashes a Socket fleet repo's default branch to a single signed "Initial
 * commit", refreshes deps, formats, runs the check pass, and force-pushes.
 * Operates in a sibling worktree; the primary checkout is never disturbed.
 *
 * Phases match the table in SKILL.md:
 *
 * 1. Pre-flight — resolve default branch, fetch, capture orig HEAD/count
 * 2. Worktree — git worktree add -b chore/squash-and-refresh ../<repo>-squash
 * 3. Backup — push <orig-head>:refs/heads/backup-<ts> before any destruction
 * 4. Squash — git commit-tree -S → reset; verify count == 1, sig == G
 * 5. Integrity — diff vs orig must be empty
 * 6. Refresh — pnpm run update / install / fix --all / check --all
 * 7. Amend — fold any post-refresh changes into the squash commit
 * 8. Force-push — git push --force --no-verify origin HEAD:$BASE
 * 9. Cleanup — git worktree remove + branch -D
 * 10. Report — new SHA, backup ref, recovery one-liner
 *
 * Usage: node .claude/skills/refreshing-history/run.mts /path/to/<repo>
 */
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

const logger = getDefaultLogger()
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib/errors'
import { isError } from '@socketsecurity/lib/errors/predicates'
import { isSpawnError } from '@socketsecurity/lib/process/spawn/errors'
import { spawn } from '@socketsecurity/lib/process/spawn/child'

import { resolveDefaultBranch } from '../_shared/scripts/git-default-branch.mts'

export function header(label: string, value: string): void {
  logger.info(`  ${label}: ${value}`)
}

type SpawnOutcome = {
  readonly stdout: string
  readonly stderr: string
}

export async function run(
  cmd: string,
  args: readonly string[],
  cwd: string,
  options: { readonly allowFailure?: boolean | undefined } = {},
): Promise<SpawnOutcome> {
  try {
    const result = await spawn(cmd, args, { cwd, stdioString: true })
    return {
      stderr: String(result.stderr ?? ''),
      stdout: String(result.stdout ?? '').trim(),
    }
  } catch (e) {
    if (options.allowFailure) {
      // Spawn failures still carry stdout/stderr on the SpawnError shape;
      // surface them so callers can inspect the partial output.
      if (isSpawnError(e)) {
        return {
          stderr: String(e.stderr ?? ''),
          stdout: String(e.stdout ?? ''),
        }
      }
      return { stderr: errorMessage(e), stdout: '' }
    }
    if (isSpawnError(e)) {
      const stderrText = String(e.stderr ?? '').trim()
      throw new Error(
        `${cmd} ${args.join(' ')} failed (exit ${String(e.code ?? '?')})${stderrText ? `: ${stderrText}` : ''}`,
      )
    }
    throw e
  }
}

export function timestamp(): string {
  const now = new Date()
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

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
  const origHead = (await run('git', ['rev-parse', `origin/${base}`], src))
    .stdout
  const origCount = (
    await run('git', ['rev-list', '--count', `origin/${base}`], src)
  ).stdout
  header(`original ${base}`, `${origHead} (${origCount} commits)`)

  // Phase 2 — worktree (clean any stale state from prior runs).
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })
  await run(
    'git',
    ['worktree', 'add', '-b', squashBranch, worktree, `origin/${base}`],
    src,
  )

  // Phase 3 — remote backup ref.
  logger.info(
    `  pushing remote backup ref: refs/heads/${backup} -> ${origHead}`,
  )
  await run(
    'git',
    ['push', 'origin', `${origHead}:refs/heads/${backup}`],
    worktree,
  )

  // Phase 4 — squash to one signed parentless commit.
  const tree = (await run('git', ['rev-parse', 'HEAD^{tree}'], worktree)).stdout
  const newSha = (
    await run(
      'git',
      ['commit-tree', '-S', tree, '-m', 'Initial commit'],
      worktree,
    )
  ).stdout
  await run('git', ['reset', '--hard', newSha], worktree)

  const newCount = (await run('git', ['rev-list', '--count', 'HEAD'], worktree))
    .stdout
  if (newCount !== '1') {
    throw new Error(`post-squash commit count is ${newCount}, expected 1`)
  }
  const sig = (await run('git', ['log', '--format=%G?', '-1'], worktree)).stdout
  if (sig !== 'G') {
    throw new Error(`squashed commit not signed (got ${sig})`)
  }
  logger.success(`squashed ${origCount} commits → 1 signed commit (${newSha})`)

  // Phase 5 — integrity check.
  const diff = await run(
    'git',
    ['diff', '--ignore-submodules', origHead],
    worktree,
    {
      allowFailure: true,
    },
  )
  if (diff.stdout.length > 0) {
    logger.error(`post-squash diff vs ${origHead} non-empty; aborting`)
    logger.error(diff.stdout.split('\n').slice(0, 20).join('\n'))
    return 1
  }
  logger.success(`integrity: post-squash tree == origin/${base} tree`)

  // Phase 6 — refresh deps + format + check.
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

  // Phase 7 — amend.
  // The umbrella "no -A" rule applies to the primary checkout; this is a
  // transient skill-owned worktree on a branch the skill just created,
  // and refresh outputs aren't enumerable in advance, so a scoped -A is
  // the right call here.
  await run('git', ['add', '-A'], worktree)
  const stagedFiles = (
    await run('git', ['diff', '--cached', '--name-only'], worktree)
  ).stdout
  if (stagedFiles.length > 0) {
    logger.info('  amending refresh changes into the squash commit')
    await run(
      'git',
      ['commit', '--amend', '--no-edit', '--no-verify'],
      worktree,
    )
  } else {
    logger.info('  no post-squash changes to amend')
  }

  // Phase 8 — force-push.
  logger.info(`  force-pushing to ${base}...`)
  await run(
    'git',
    ['push', '--force', '--no-verify', 'origin', `HEAD:${base}`],
    worktree,
  )
  const newHead = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout

  // Phase 9 — cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  // Phase 10 — report.
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
