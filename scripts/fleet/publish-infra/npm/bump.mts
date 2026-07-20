/**
 * @file Version-bump orchestration for the npm-publish CI path: resolve the
 *   repo-overlay-or-canonical bump script, run it, then commit the bumped
 *   files via the GitHub git-objects API for a signed commit without a local
 *   GPG key.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { commitViaGithubApi } from '../../lib/commit-via-github-api.mts'
import {
  discardReleaseBranch,
  openReleaseBranch,
  resolveReleaseEnv,
} from '../release-branch.mts'
import { logger, rootPath, runCapture, runInherit } from '../shared.mts'
import { readPackageJson } from './shared.mts'

import type { BumpResult } from '../release-branch.mts'

/**
 * Resolve the bump script overlay-first: a repo-specific scripts/repo/bump.mts
 * (monorepo / custom bumps, e.g. socket-registry) wins over the canonical
 * scripts/fleet/bump.mts — the same .config/repo-over-.config/fleet precedence
 * the rest of the fleet uses. `root` is injectable for tests.
 */
export function resolveBumpScript(root: string = rootPath): string {
  const repoBump = path.join(root, 'scripts', 'repo', 'bump.mts')
  return existsSync(repoBump)
    ? repoBump
    : path.join(root, 'scripts', 'fleet', 'bump.mts')
}

/**
 * CI bump stage (the workflow runs `publish.mts --staged --bump`). Runs the
 * resolved bump script with --write-only (writes package.json + CHANGELOG, no
 * commit), then commits the changed files via the GitHub git-objects API so the
 * commit is verified/SIGNED without a GPG key — authenticated with the in-house
 * release APP token (RELEASE_APP_TOKEN / GH_TOKEN env, set by the workflow's
 * app-token minter, NOT the default github.token). The commit lands on a
 * throwaway `npm-publish-v<version>` branch (NOT main): the caller
 * fast-forwards main to it only once the publish succeeds, and nukes it on a
 * rejected publish, so a failed stage never creeps the version on main. Resets
 * the checkout to the new commit so the publish runs against the bumped tree,
 * and returns the branch + tip SHA for the caller to promote / discard.
 * Dry-run previews the bump (bump.mts --dry-run writes nothing), commits
 * nothing, and returns undefined; a no-op bump (no file changes) also returns
 * undefined.
 */
export async function runBump(options: {
  dryRun: boolean
  releaseAs?: string | undefined
}): Promise<BumpResult | undefined> {
  const opts = { __proto__: null, ...options } as {
    dryRun: boolean
    releaseAs?: string | undefined
  }
  const args = [resolveBumpScript(), '--write-only']
  if (opts.releaseAs) {
    args.push('--release-as', opts.releaseAs)
  }
  if (opts.dryRun) {
    args.push('--dry-run')
  }
  const code = await runInherit(process.execPath, args, rootPath)
  if (code !== 0) {
    throw new Error(`[bump] bump script exited ${code}`)
  }
  if (opts.dryRun) {
    logger.log('[bump] dry-run — previewed, nothing committed.')
    return
  }
  const diff = await runCapture('git', ['diff', '--name-only'], rootPath)
  const files = diff.stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
  if (files.length === 0) {
    logger.log('[bump] no changes from the bump — nothing to commit.')
    return
  }
  const env = resolveReleaseEnv()
  const commitFiles = files.map(p => ({
    content: readFileSync(path.join(rootPath, p), 'utf8'),
    path: p,
  }))
  const parent = await runCapture('git', ['rev-parse', 'HEAD'], rootPath)
  const baseTree = await runCapture(
    'git',
    ['rev-parse', 'HEAD^{tree}'],
    rootPath,
  )
  const version = readPackageJson().version
  const parentSha = parent.stdout.trim()
  // Land the bump on a throwaway npm-publish-v<version> branch, NOT main — the
  // caller fast-forwards main to it only after the publish succeeds, and nukes
  // it on rejection, so a failed stage never creeps the version.
  const releaseBranch = await openReleaseBranch({
    channel: 'npm',
    env,
    parentSha,
    version,
  })
  // Once the branch exists, any failure below must nuke it — otherwise a leftover
  // <channel>-publish-v<version> branch accumulates (main is never touched, so
  // the version-creep invariant holds regardless).
  try {
    const sha = await commitViaGithubApi({
      baseTreeSha: baseTree.stdout.trim(),
      branch: releaseBranch.branch,
      files: commitFiles,
      message: `chore: bump version to ${version}`,
      parentSha,
      repo: env.repo,
      token: env.token,
    })
    await runCapture('git', ['fetch', 'origin', releaseBranch.branch], rootPath)
    await runCapture('git', ['reset', '--hard', sha], rootPath)
    logger.success(
      `[bump] ${version} committed ${sha.slice(0, 7)} on ${releaseBranch.branch} ` +
        'via the release App.',
    )
    // Rebuild AFTER the reset: the workflow's pre-build ran on the PRE-bump
    // tree, and `git reset --hard` leaves the gitignored dist/ untouched — so
    // without this the publish packs stale bytes (a staged artifact once
    // shipped with the `X.Y.Z-prerelease` hint version baked into dist/). The
    // staged artifact must be built from the exact bump commit it claims.
    logger.log('[bump] rebuilding dist/ from the bump commit…')
    const rebuild = await runInherit('pnpm', ['run', 'build'], rootPath)
    if (rebuild !== 0) {
      throw new Error(`[bump] post-bump rebuild exited ${rebuild}`)
    }
    return { releaseBranch, sha }
  } catch (e) {
    await discardReleaseBranch(releaseBranch)
    throw e
  }
}
