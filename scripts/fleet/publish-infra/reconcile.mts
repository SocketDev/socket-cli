/*
 * @file Publish-flow git reconcile (code-as-law). After a release publishes,
 *   local main must be aligned with the freshly-released remote — our remaining
 *   changes on top of the newly-published base, never a divergent local main.
 *   Two fail-LOUD steps (a publish lineage is never auto-resolved), both run
 *   ONCE PUBLISHED — after `--approve`, default on a LOCAL publish;
 *   `--no-reconcile` opts out; CI `--staged` never reconciles:
 *
 *   - Rebase-onto-published: resolve the now-published version from the registry,
 *     find the origin/main commit that bumped to it, and rebase our remaining
 *     local commits onto that commit. Any conflict aborts the rebase and
 *     throws.
 *   - Fast-forward: pull local main up to the now-updated origin so the local
 *     tree matches the freshly-released remote.
 */

import { NPM_REGISTRY_URL } from '../constants/npm-registry.mts'
import { fetchLatestPublishedVersion } from './npm/registry.mts'
import { logger, runCapture } from './shared.mts'

/**
 * The registry `dist-tags.latest` for a package — the currently-published
 * version. Wraps the tolerant reader (single dist-tags source of truth) and
 * throws What/Where/Saw/Fix when the tag can't be resolved, because a reconcile
 * lineage is never auto-resolved on a missing base.
 */
export async function fetchPublishedVersion(name: string): Promise<string> {
  const latest = await fetchLatestPublishedVersion(name)
  if (!latest) {
    throw new Error(
      `reconcile: could not read the published version of ${name}.\n` +
        `  Where: ${NPM_REGISTRY_URL}/${encodeURIComponent(name).replace('%40', '@')}\n` +
        `  Saw: no dist-tags.latest (registry unreachable, or first publish / dist-tag lag)\n` +
        `  Fix: check network / registry reachability, then re-run — or --no-reconcile.`,
    )
  }
  return latest
}

/**
 * The origin/main SHA that bumped to `version` — the published release commit
 * we rebase onto. Matches the canonical bump subject `chore: bump version to
 * <version>`. Fetches origin first. Throws when no such commit exists.
 */
export async function findPublishedBaseSha(
  cwd: string,
  version: string,
): Promise<string> {
  await runCapture('git', ['fetch', 'origin', 'main'], cwd)
  const subject = `chore: bump version to ${version}`
  const { code, stdout } = await runCapture(
    'git',
    ['log', 'FETCH_HEAD', '--format=%H %s', '--max-count=500'],
    cwd,
  )
  if (code === 0) {
    const lines = stdout.split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      const sha = line.slice(0, line.indexOf(' '))
      const msg = line.slice(line.indexOf(' ') + 1)
      if (sha && msg === subject) {
        return sha
      }
    }
  }
  throw new Error(
    `reconcile: no "${subject}" commit on origin/main.\n` +
      `  Where: git log FETCH_HEAD (origin/main)\n` +
      `  Saw: the published version's bump commit is not in the last 500 commits.\n` +
      `  Fix: confirm the published version matches a release commit on origin/main.`,
  )
}

/**
 * Rebase the local branch's commits onto `baseSha` (the published release). The
 * working tree MUST be clean. Any conflict aborts the rebase and throws — a
 * publish lineage is never auto-resolved. No-op when already on `baseSha`.
 */
export async function rebaseOntoPublishedBase(
  cwd: string,
  baseSha: string,
): Promise<void> {
  const status = await runCapture('git', ['status', '--porcelain'], cwd)
  if (status.stdout.trim().length > 0) {
    throw new Error(
      'reconcile: working tree is dirty — cannot rebase for publish.\n' +
        `  Saw: ${status.stdout.trim().split('\n').length} uncommitted path(s).\n` +
        '  Fix: commit or set aside your changes, then re-run the publish.',
    )
  }
  const rebase = await runCapture('git', ['rebase', baseSha], cwd)
  if (rebase.code !== 0) {
    await runCapture('git', ['rebase', '--abort'], cwd)
    throw new Error(
      `reconcile: rebase onto ${baseSha.slice(0, 8)} (the published base) hit a conflict.\n` +
        '  Where: git rebase (aborted — tree restored).\n' +
        "  Saw: our local commits don't apply cleanly on the published release.\n" +
        '  Fix: resolve the divergence by hand (or re-run with --no-reconcile).',
    )
  }
  logger.success(
    `reconcile: rebased local commits onto published base ${baseSha.slice(0, 8)}.`,
  )
}

/**
 * Fast-forward local main to origin/main. Run AFTER a release is approved (the
 * release App has pushed the new bump), so the local tree matches the now-
 * updated remote. `--ff-only` refuses if local has diverged — a diverged main
 * post-approve means something else pushed, so surface it rather than merge.
 */
export async function syncFromOriginMain(cwd: string): Promise<void> {
  const pull = await runCapture(
    'git',
    ['pull', '--ff-only', 'origin', 'main'],
    cwd,
  )
  if (pull.code !== 0) {
    throw new Error(
      'reconcile: could not fast-forward local main to origin/main after approve.\n' +
        '  Where: git pull --ff-only origin main.\n' +
        '  Saw: local main has diverged from origin (a non-ff pull).\n' +
        '  Fix: reconcile local main forward by hand — do not force.',
    )
  }
  logger.success('reconcile: local main fast-forwarded to origin/main.')
}
