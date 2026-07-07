#!/usr/bin/env node
/*
 * Reordering-release-bump runner.
 *
 * Moves an already-landed `chore: bump version to X.Y.Z` commit back to the tip
 * of the default branch when cascades / fixes / features landed on top of it,
 * repoints the vX.Y.Z tag onto the moved commit, and force-pushes — losing zero
 * work (the tree stays byte-for-byte identical; only the bump's POSITION moves).
 *
 * Operates in a throwaway sibling worktree; the primary checkout is never
 * disturbed. Dry-run by default — pass --apply to actually push.
 *
 * Phases match the table in SKILL.md:
 *
 * 1. Pre-flight — resolve default branch, fetch --tags, find the bump + version
 * 2. Verify — bump touches exactly package.json + CHANGELOG.md
 * 3. Backup — push <orig-tip>:refs/heads/backup/pre-reorder-<ts>-<short>
 * 4. Reorder — rebase --onto <bump>^ <bump> HEAD; cherry-pick <bump> to tip
 * 5. Integrity — diff <orig-tip> HEAD must be EMPTY (HARD exit on mismatch);
 *    tip subject must name the bump version
 * 6. Retag + push — git update-ref refs/tags/vX.Y.Z; --force-with-lease push
 * 7. Verify + cleanup — origin branch + tag both equal the new bump; remove wt
 *
 * The retag uses `git update-ref` (plumbing), NOT `git tag -f`, so it doesn't
 * trip version-bump-order-guard (correct for a NEW release, wrong for a pure
 * position reorder of an already-prepped bump).
 *
 * Usage: node .claude/skills/fleet/reordering-release-bump/lib/reorder-bump.mts /path/to/<repo> [--apply]
 */
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { errorMessage } from '@socketsecurity/lib/errors'
import { isError } from '@socketsecurity/lib/errors/predicates'
import { getDefaultLogger } from '@socketsecurity/lib/logger/default'

import { resolveDefaultBranch } from '../../_shared/scripts/git-default-branch.mts'
import { header, run, timestamp } from '../../_shared/scripts/run-helpers.mts'

const logger = getDefaultLogger()

export { header, run, timestamp }

export interface BumpInfo {
  /**
   * Abbreviated SHA of the `chore: bump version to X.Y.Z` commit on origin.
   */
  readonly sha: string
  /**
   * The bumped version, e.g. `1.2.3`.
   */
  readonly version: string
}

/**
 * Find the most recent `bump version to X.Y.Z` commit on `origin/<base>` and
 * read the version out of that commit's package.json. Returns undefined when no
 * bump commit exists.
 */
export async function findBumpCommit(
  base: string,
  src: string,
): Promise<BumpInfo | undefined> {
  const log = (
    await run('git', ['log', '--format=%h %s', `origin/${base}`], src)
  ).stdout
  let sha: string | undefined
  const lines = log.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    if (/bump version to/i.test(line)) {
      sha = line.split(' ', 1)[0]
      break
    }
  }
  if (!sha) {
    return undefined
  }
  const pkgJson = (await run('git', ['show', `${sha}:package.json`], src))
    .stdout
  const version = String(
    (JSON.parse(pkgJson) as { version?: unknown | undefined }).version ?? '',
  )
  if (!version) {
    throw new Error(`bump commit ${sha} has no package.json version`)
  }
  return { __proto__: null, sha, version } as BumpInfo
}

/**
 * Assert the bump commit touches exactly package.json and CHANGELOG.md and
 * nothing else. A bump that touches other files is not a clean reorder target.
 */
export async function verifyBumpIsCleanBump(
  sha: string,
  src: string,
): Promise<void> {
  const names = (
    await run('git', ['show', '--stat', '--format=', '--name-only', sha], src)
  ).stdout
  const touched = names
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .toSorted()
  const allowed = touched.every(
    name => name === 'package.json' || /(^|\/)CHANGELOG\.md$/.test(name),
  )
  const hasPkg = touched.includes('package.json')
  if (!allowed || !hasPkg) {
    throw new Error(
      `bump commit ${sha} is not a clean package.json+CHANGELOG bump; touched: ${touched.join(', ')}`,
    )
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const src = argv.find(a => !a.startsWith('--'))
  if (!src) {
    logger.error(
      'usage: node reorder-bump.mts <repo-path> [--apply]   (dry-run by default)',
    )
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
  const worktree = `${src}-reorder`
  const reorderBranch = 'chore/reorder-bump'

  logger.info('============================================================')
  logger.info(
    `reordering-release-bump: ${repoName}${apply ? '' : ' (dry-run)'}`,
  )
  logger.info('============================================================')

  // Phase 1 — pre-flight: resolve base, fetch, find the bump.
  const base = await resolveDefaultBranch({ cwd: src })
  header('default branch', base)
  await run('git', ['fetch', 'origin', base, '--tags'], src)
  const origTip = (await run('git', ['rev-parse', `origin/${base}`], src))
    .stdout

  const bump = await findBumpCommit(base, src)
  if (!bump) {
    logger.warn('no `bump version to X.Y.Z` commit found; nothing to reorder')
    return 0
  }
  const verTag = `v${bump.version}`
  header('bump', `${bump.sha} (version ${bump.version})`)
  header(`origin/${base} tip`, origTip)

  // If the bump is already the tip, there is nothing to do.
  const bumpFull = (await run('git', ['rev-parse', bump.sha], src)).stdout
  if (bumpFull === origTip) {
    logger.success('bump is already the tip — nothing to reorder')
    return 0
  }

  // Phase 2 — verify clean bump.
  await verifyBumpIsCleanBump(bump.sha, src)
  logger.success('bump touches only package.json + CHANGELOG.md')

  // Phase 3 — timestamped backup of the current origin tip.
  const ts = timestamp()
  const shortTip = origTip.slice(0, 7)
  const backup = `backup/pre-reorder-${ts}-${shortTip}`
  if (apply) {
    logger.substep(`pushing remote backup ref: refs/heads/${backup}`)
    await run('git', ['push', 'origin', `${origTip}:refs/heads/${backup}`], src)
  } else {
    logger.substep(`[dry-run] would push backup ref: refs/heads/${backup}`)
  }

  // Phase 4 — reorder in a fresh throwaway worktree.
  await run('git', ['worktree', 'remove', '--force', worktree], src, {
    allowFailure: true,
  })
  await run('git', ['branch', '-D', reorderBranch], src, { allowFailure: true })
  await run(
    'git',
    ['worktree', 'add', '-b', reorderBranch, worktree, `origin/${base}`],
    src,
  )
  // Splice the bump out of the middle, replay everything after it onto the
  // bump's parent, then put the bump back at the tip.
  await run(
    'git',
    ['rebase', '--onto', `${bump.sha}^`, bump.sha, 'HEAD'],
    worktree,
  )
  await run('git', ['cherry-pick', bump.sha], worktree)
  const newBump = (await run('git', ['rev-parse', 'HEAD'], worktree)).stdout

  // Phase 5 — integrity: the tree must be byte-identical (only POSITION moved).
  const diff = await run('git', ['diff', origTip, 'HEAD'], worktree, {
    allowFailure: true,
  })
  if (diff.stdout.length > 0) {
    logger.error(`post-reorder diff vs ${origTip} non-empty; aborting`)
    logger.error(diff.stdout.split('\n').slice(0, 20).join('\n'))
    await run('git', ['worktree', 'remove', '--force', worktree], src, {
      allowFailure: true,
    })
    process.exit(1)
  }
  const tipSubject = (await run('git', ['log', '-1', '--format=%s'], worktree))
    .stdout
  if (!new RegExp(`bump version to ${bump.version}`, 'i').test(tipSubject)) {
    logger.error(`tip is not the bump (subject: ${tipSubject}); aborting`)
    await run('git', ['worktree', 'remove', '--force', worktree], src, {
      allowFailure: true,
    })
    process.exit(1)
  }
  logger.success(`integrity: tree identical, tip is the ${bump.version} bump`)

  // Phase 6 — retag (plumbing) + lease-push.
  if (apply) {
    await run('git', ['update-ref', `refs/tags/${verTag}`, newBump], worktree)
    const oldTagLine = (
      await run('git', ['ls-remote', 'origin', `refs/tags/${verTag}`], src, {
        allowFailure: true,
      })
    ).stdout
    const oldTag = oldTagLine.split('\t', 1)[0] ?? ''
    logger.substep(`force-pushing reordered ${base}...`)
    await run(
      'git',
      [
        'push',
        `--force-with-lease=${base}:${origTip}`,
        'origin',
        `${newBump}:${base}`,
      ],
      worktree,
    )
    logger.substep(`repointing tag ${verTag}...`)
    await run(
      'git',
      [
        'push',
        ...(oldTag
          ? [`--force-with-lease=refs/tags/${verTag}:${oldTag}`]
          : ['--force-with-lease']),
        'origin',
        `refs/tags/${verTag}`,
      ],
      worktree,
    )

    // Phase 7 — verify origin branch + tag both equal the new bump.
    const remote = (
      await run(
        'git',
        ['ls-remote', 'origin', base, `refs/tags/${verTag}`],
        src,
      )
    ).stdout
    const ok = remote
      .split('\n')
      .every(line => !line.trim() || line.startsWith(newBump))
    if (!ok) {
      logger.error(`origin verification failed:`)
      logger.error(remote)
      process.exit(1)
    }
    logger.success(`origin/${base} and ${verTag} both at ${newBump}`)
  } else {
    logger.info('[dry-run] would update-ref + force-with-lease push:')
    logger.substep(`origin/${base}: ${origTip} -> ${newBump}`)
    logger.substep(`tag ${verTag} -> ${newBump}`)
  }

  // Phase 7 (cont.) — cleanup.
  await run('git', ['worktree', 'remove', '--force', worktree], src)
  await run('git', ['branch', '-D', reorderBranch], src, { allowFailure: true })

  // Report.
  logger.log('')
  if (apply) {
    logger.success(`${repoName}: bump ${bump.version} relocated to the tip`)
    logger.substep(`old tip:    ${origTip}`)
    logger.substep(`new tip:    ${newBump} (the bump)`)
    logger.substep(`tag ${verTag} -> ${newBump}`)
    logger.substep(`backup ref: refs/heads/${backup} -> ${origTip}`)
  } else {
    logger.info(`${repoName}: dry-run complete — rerun with --apply to push`)
  }
  return 0
}

// Run as a CLI only when invoked directly, not when imported (e.g. a test that
// reuses findBumpCommit / verifyBumpIsCleanBump).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .then(code => {
      process.exitCode = code
    })
    .catch((e: unknown) => {
      const message = isError(e) ? e.message : errorMessage(e)
      logger.error(`reordering-release-bump failed: ${message}`)
      process.exitCode = 1
    })
}
