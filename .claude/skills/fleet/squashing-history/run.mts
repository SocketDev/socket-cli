#!/usr/bin/env node
/*
 * Squashing-history runner — the low-level squash-to-one-commit primitive.
 *
 * Collapses a Socket fleet repo's default branch to a single
 * "chore: initial commit", verifies the tree is byte-identical to the
 * pre-squash backup, and force-pushes with a lease. The SQUASH_HISTORY=1
 * sentinel scopes the no-revert-guard `--no-verify` bypass on the amend and
 * the no-force-push-guard bypass on the push to exactly those two commands.
 * Operates in a sibling worktree; the primary checkout is never disturbed.
 *
 * Phases match the table in SKILL.md:
 *
 * 1. Pre-flight — resolve default branch, fetch, capture orig HEAD/count
 * 2. Worktree — git worktree add -b chore/squash ../<repo>-squash
 * 3. Backup — push <orig-head>:refs/heads/backup-<ts> before any destruction
 * 4. Squash — reset --soft to first commit + amend; count == 1 gate
 * 5. Integrity — diff vs orig must be empty (HARD exit on mismatch)
 * 6. Force-push — SQUASH_HISTORY=1 git push --force-with-lease origin HEAD:$BASE
 * 7. Cleanup — git worktree remove + branch -D
 * 8. Report — new SHA, backup ref, recovery one-liner
 *
 * The squash mechanics live in squashSingleCommit() so refreshing-history (the
 * higher-level dep-refresh wrapper) can reuse the same engine without copying
 * the reset/amend/count/integrity dance.
 *
 * Usage: node .claude/skills/fleet/squashing-history/run.mts /path/to/<repo>
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { errorMessage } from '@socketsecurity/lib/errors/message'
import { isError } from '@socketsecurity/lib/errors/predicates'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { slugFromRemoteUrl } from '../../../hooks/fleet/_shared/fleet-repos.mts'
import {
  isOptedIn,
  loadRosterFromRepo,
} from '../../../hooks/fleet/_shared/fleet-roster.mts'
import { resolveDefaultBranch } from '../_shared/scripts/git-default-branch.mts'
import { header, run, timestamp } from '../_shared/scripts/run-helpers.mts'

const logger = getDefaultLogger()

/**
 * The canonical fleet name of a checkout — its origin remote slug (so a
 * differently-named local directory still resolves to the roster identity),
 * falling back to the directory basename when there is no origin.
 */
export async function resolveFleetName(src: string): Promise<string> {
  try {
    const url = (
      await run('git', ['remote', 'get-url', 'origin'], src)
    ).stdout.trim()
    const slug = slugFromRemoteUrl(url)
    if (slug) {
      return slug
    }
  } catch {}
  return path.basename(src)
}

export { header, run, timestamp }

export interface SquashOptions {
  /**
   * Commit subject for the collapsed commit. Defaults to
   * 'chore: initial commit'.
   */
  readonly message?: string | undefined
  /**
   * Pre-squash SHA the post-squash tree must match exactly. A mismatch is a
   * HARD failure — the function calls process.exit(1) rather than returning.
   */
  readonly origHead: string
  /**
   * Sign the collapsed commit and assert the signature verifies (`%G?` == 'G').
   * Needed where branch protection mandates `required_signatures`
   * (refreshing-history). Defaults to false.
   */
  readonly sign?: boolean | undefined
  /**
   * Worktree directory the squash runs in (never the primary checkout).
   */
  readonly worktree: string
}

export interface SquashResult {
  readonly newHead: string
}

/**
 * Collapse the worktree's branch to a single commit via soft-reset onto the
 * root commit followed by an amend, then assert exactly one commit remains and
 * the tree is byte-identical to `origHead`. A tree mismatch is unrecoverable
 * corruption of intent, so it triggers a HARD `process.exit(1)`.
 *
 * The SQUASH_HISTORY=1 sentinel on the amend scopes the no-revert-guard
 * `--no-verify` bypass to exactly this one command.
 */
export async function squashSingleCommit(
  options: SquashOptions,
): Promise<SquashResult> {
  const opts = { __proto__: null, ...options } as {
    message?: string | undefined
    origHead: string
    sign?: boolean | undefined
    worktree: string
  }
  const message = opts.message ?? 'chore: initial commit'
  const sign = opts.sign ?? false
  const { origHead, worktree } = opts

  // Soft-reset onto the root commit (keeps every change staged), then amend the
  // root so the result is a single commit — not root + 1.
  const firstCommit = (
    await run('git', ['rev-list', '--max-parents=0', 'HEAD'], worktree)
  ).stdout
  await run('git', ['reset', '--soft', firstCommit], worktree)
  // -S signs via the user's configured key; the bare commit.gpgsign config is
  // unreliable for amend in a fresh worktree, so pass the flag explicitly.
  const amendArgs = sign
    ? ['commit', '--amend', '--no-verify', '-S', '-m', message]
    : ['commit', '--amend', '--no-verify', '-m', message]
  await run('git', amendArgs, worktree, { env: { SQUASH_HISTORY: '1' } })

  const newCount = (await run('git', ['rev-list', '--count', 'HEAD'], worktree))
    .stdout
  if (newCount !== '1') {
    throw new Error(`post-squash commit count is ${newCount}, expected 1`)
  }
  if (sign) {
    const sig = (await run('git', ['log', '--format=%G?', '-1'], worktree))
      .stdout
    if (sig !== 'G') {
      throw new Error(`squashed commit not signed (got ${sig})`)
    }
  }

  // Integrity gate — the whole point is zero content change. A non-empty diff
  // means the squash altered the tree; that is corruption, so exit hard.
  const diff = await run(
    'git',
    ['diff', '--ignore-submodules', origHead],
    worktree,
    { allowFailure: true },
  )
  if (diff.stdout.length > 0) {
    logger.error(`post-squash diff vs ${origHead} non-empty; aborting`)
    logger.error(diff.stdout.split('\n').slice(0, 20).join('\n'))
    process.exit(1)
  }

  const newHead = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout
  return { __proto__: null, newHead } as SquashResult
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

  // Code-is-law opt-in gate. Squash is destructive history rewrite, so the
  // ROSTER decides which repos it may touch — not a path arg a human (or a
  // fuzzy name-match) points at. Resolve the checkout to its canonical fleet
  // name (origin slug, EXACT — no fuzzy fallback to a look-alike), then refuse
  // unless that name carries the `squash-history` opt-in. A non-fleet repo
  // (no roster, or absent from it) is refused outright: this is the guard that
  // stops a `cdxgen` from being squashed because it resembles `sdxgen`.
  const fleetName = await resolveFleetName(src)
  const roster = loadRosterFromRepo(src)
  if (!roster) {
    logger.error(
      `error: ${src} carries no fleet roster (cascading-fleet/lib/` +
        `fleet-repos.json) — it is not a fleet repo, so squash is refused. ` +
        `Squash only opted-in fleet members.`,
    )
    return 2
  }
  if (!isOptedIn(roster, fleetName, 'squash-history')) {
    logger.error(
      `error: ${fleetName} is not opted into 'squash-history' in the fleet ` +
        `roster — refusing to rewrite its history. ` +
        `Saw: no 'squash-history' in its optIns; wanted the opt-in. ` +
        `Fix: add "${fleetName}" with optIns:['squash-history'] to ` +
        `cascading-fleet/lib/fleet-repos.json (then cascade), or squash a ` +
        `repo that is already opted in.`,
    )
    return 2
  }

  const repoName = fleetName
  const worktree = `${src}-squash`
  const ts = timestamp()
  const backup = `backup-${ts}`
  const squashBranch = 'chore/squash'

  logger.info('============================================================')
  logger.info(`squashing-history: ${repoName}`)
  logger.info('============================================================')

  // Phase 1 — pre-flight.
  const base = await resolveDefaultBranch({ cwd: src })
  header('default branch', base)
  await run('git', ['fetch', 'origin', base], src)

  // A shallow clone's commit graph is grafted, so `rev-list --count` reports
  // the fetch depth, not the branch's true history — a depth-1 clone always
  // reads as "already squashed" and the single-commit early-exit silently
  // no-ops on a full-history remote. Refuse loudly; unshallow first (or
  // squash via a tree snapshot, which needs no history).
  const shallow = (
    await run('git', ['rev-parse', '--is-shallow-repository'], src)
  ).stdout
  if (shallow === 'true') {
    logger.error(
      `error: ${src} is a SHALLOW clone — its local graph cannot answer ` +
        `"how many commits does origin/${base} have". ` +
        `Saw a grafted history; wanted the full graph. ` +
        `Fix: git -C ${src} fetch --unshallow origin ${base}, then re-run.`,
    )
    return 2
  }

  const origHead = (await run('git', ['rev-parse', `origin/${base}`], src))
    .stdout
  const origCount = (
    await run('git', ['rev-list', '--count', `origin/${base}`], src)
  ).stdout
  header(`original ${base}`, `${origHead} (${origCount} commits)`)

  if (origCount === '1') {
    logger.info('already a single commit — nothing to squash')
    return 0
  }

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
  logger.substep(
    `pushing remote backup ref: refs/heads/${backup} -> ${origHead}`,
  )
  // --no-verify: the worktree is freshly added off origin/base with no
  // node_modules, so the repo's git pre-push hook (which imports
  // @socketsecurity/lib-stable) cannot load. A backup ref carries only the
  // existing, already-validated history; nothing new exists to verify.
  await run(
    'git',
    ['push', '--no-verify', 'origin', `${origHead}:refs/heads/${backup}`],
    worktree,
  )

  // Phase 4 + 5 — squash + integrity (shared engine; HARD exit on mismatch).
  // sign: a fleet repo's default branch must carry signed commits, and GitHub
  // enforces required_signatures server-side regardless of --no-verify below.
  const { newHead } = await squashSingleCommit({
    origHead,
    sign: true,
    worktree,
  })
  logger.success(`squashed ${origCount} commits → 1 commit (${newHead})`)
  logger.success(`integrity: post-squash tree == origin/${base} tree`)

  // Phase 6 — force-push (lease guards against a racing push).
  logger.substep(`force-pushing to ${base}...`)
  // --no-verify for the same reason as the backup push (no node_modules in the
  // worktree). The squash commit is already integrity-checked and
  // signature-asserted above, so the pre-push hook's checks are redundant.
  await run(
    'git',
    ['push', '--no-verify', '--force-with-lease', 'origin', `HEAD:${base}`],
    worktree,
    { env: { SQUASH_HISTORY: '1' } },
  )

  // Phase 7 — cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', squashBranch], src, { allowFailure: true })

  // Phase 8 — report.
  logger.log('')
  logger.success(`${repoName} squashed`)
  logger.substep(`new ${base}:   ${newHead}`)
  logger.substep(`backup ref: refs/heads/${backup} -> ${origHead}`)
  logger.substep(
    `recover:    git fetch origin ${backup} && git push --force origin FETCH_HEAD:${base}`,
  )
  return 0
}

// Run as a CLI only when invoked directly, not when imported by a sibling (e.g.
// refreshing-history/run.mts) or a test that reuses squashSingleCommit().
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then(code => {
      process.exitCode = code
    })
    .catch((e: unknown) => {
      const message = isError(e) ? e.message : errorMessage(e)
      logger.error(`squashing-history failed: ${message}`)
      process.exitCode = 1
    })
}
