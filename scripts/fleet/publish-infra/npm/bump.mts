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
import { logger, rootPath, runCapture, runInherit } from '../shared.mts'
import { readPackageJson } from './shared.mts'

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
 * app-token minter, NOT the default github.token). Resets the checkout to the
 * new commit so the publish runs against the bumped tree. Dry-run previews the
 * bump (bump.mts --dry-run writes nothing) and commits nothing.
 */
export async function runBump(options: {
  dryRun: boolean
  releaseAs?: string | undefined
}): Promise<void> {
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
  const repo = process.env['GITHUB_REPOSITORY']
  const branch = process.env['GITHUB_REF_NAME']
  // The in-house release App token (minted by the workflow's app-token action),
  // NOT the default github.token — least-privilege + verified/app-attributed.
  const token =
    process.env['RELEASE_APP_TOKEN'] || process.env['GH_TOKEN'] || ''
  if (!repo || !branch || !token) {
    throw new Error(
      '[bump] needs GITHUB_REPOSITORY, GITHUB_REF_NAME, and a release App token ' +
        '(RELEASE_APP_TOKEN / GH_TOKEN) in the environment.',
    )
  }
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
  const sha = await commitViaGithubApi({
    baseTreeSha: baseTree.stdout.trim(),
    branch,
    files: commitFiles,
    message: `chore: bump version to ${version}`,
    parentSha: parent.stdout.trim(),
    repo,
    token,
  })
  await runCapture('git', ['fetch', 'origin', branch], rootPath)
  await runCapture('git', ['reset', '--hard', sha], rootPath)
  logger.success(
    `[bump] ${version} committed ${sha.slice(0, 7)} via the release App.`,
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
}
