/**
 * @file Registry-agnostic release-branch orchestration for the CI publish path.
 *   The version bump commits land on a throwaway `<channel>-publish-v<version>`
 *   branch instead of directly on `main`; only a SUCCESSFUL publish
 *   fast-forwards `main` to that branch tip (same SHA) then deletes it, and a
 *   FAILED publish deletes the branch so `main` is never touched — no version
 *   creep, and safe when `main` is branch-protected. Shared by the npm + cargo
 *   bump tiers (both accumulate their commit(s) on the branch this opens).
 */

import process from 'node:process'

import { HttpResponseError } from '@socketsecurity/lib-stable/http-request'

import {
  createBranchRef,
  deleteBranchRef,
  updateBranchRef,
} from '../lib/github-git-refs.mts'
import { logger } from './shared.mts'

export interface ReleaseEnv {
  // Branch the successful publish fast-forwards (the dispatch branch, e.g. 'main').
  readonly mainBranch: string
  // Repo in "owner/name" form.
  readonly repo: string
  // Release App token with contents:write.
  readonly token: string
}

export interface ReleaseBranch {
  // The `<channel>-publish-v<version>` branch holding this run's bump commit(s).
  readonly branch: string
  // The resolved CI release environment.
  readonly env: ReleaseEnv
}

export interface BumpResult {
  // The release branch this run's bump commit(s) landed on.
  readonly releaseBranch: ReleaseBranch
  // The branch tip SHA to fast-forward main to once the publish succeeds.
  readonly sha: string
}

/**
 * Resolve the CI release environment (repo, dispatch branch, release App
 * token). Throws loud — What / Where / Fix — when any piece is missing, since a
 * CI bump can neither branch nor promote without all three.
 */
export function resolveReleaseEnv(): ReleaseEnv {
  const repo = process.env['GITHUB_REPOSITORY']
  const mainBranch = process.env['GITHUB_REF_NAME']
  // The in-house release App token (minted by the workflow's app-token action),
  // NOT the default github.token — least-privilege + verified/app-attributed.
  const token =
    process.env['RELEASE_APP_TOKEN'] || process.env['GH_TOKEN'] || ''
  if (!repo || !mainBranch || !token) {
    throw new Error(
      '[release-branch] the CI bump needs GITHUB_REPOSITORY, GITHUB_REF_NAME, ' +
        'and a release App token (RELEASE_APP_TOKEN / GH_TOKEN) in the ' +
        'environment. Set them in the publish workflow step, then re-run.',
    )
  }
  return { mainBranch, repo, token }
}

/**
 * Branch name for a channel + version, e.g. `npm-publish-v1.4.3`. Distinct,
 * predictable, and greppable so a stranded branch is obvious.
 */
export function releaseBranchName(channel: string, version: string): string {
  return `${channel}-publish-v${version}`
}

/**
 * Create `<channel>-publish-v<version>` at `parentSha`. Idempotent: a leftover
 * branch from an earlier crashed / re-run publish (create returns 422) is
 * force-reset to `parentSha`, so this run's commit(s) land on a clean lineage
 * off the current base.
 */
export async function openReleaseBranch(options: {
  channel: string
  env: ReleaseEnv
  parentSha: string
  version: string
}): Promise<ReleaseBranch> {
  const opts = { __proto__: null, ...options } as {
    channel: string
    env: ReleaseEnv
    parentSha: string
    version: string
  }
  const { env } = opts
  const branch = releaseBranchName(opts.channel, opts.version)
  try {
    await createBranchRef({
      branch,
      repo: env.repo,
      sha: opts.parentSha,
      token: env.token,
    })
  } catch (e) {
    const status =
      e instanceof HttpResponseError ? e.response.status : undefined
    if (status !== 422) {
      throw e
    }
    await updateBranchRef({
      branch,
      force: true,
      repo: env.repo,
      sha: opts.parentSha,
      token: env.token,
    })
  }
  logger.log(
    `[release-branch] opened ${branch} at ${opts.parentSha.slice(0, 7)}.`,
  )
  return { branch, env }
}

/**
 * Publish succeeded: fast-forward the dispatch branch to the release branch tip
 * (`tipSha` — the exact commit that was built + published, same SHA), then
 * delete the release branch. Fast-forward-only: if the dispatch branch moved
 * mid-publish the advance is a non-fast-forward and `updateBranchRef` throws
 * loud, leaving the branch for manual reconcile rather than rewriting history.
 */
export async function promoteReleaseBranch(
  releaseBranch: ReleaseBranch,
  tipSha: string,
): Promise<void> {
  const { branch, env } = releaseBranch
  await updateBranchRef({
    branch: env.mainBranch,
    force: false,
    repo: env.repo,
    sha: tipSha,
    token: env.token,
  })
  await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  logger.success(
    `[release-branch] fast-forwarded ${env.mainBranch} to ${tipSha.slice(0, 7)} ` +
      `and removed ${branch}.`,
  )
}

/**
 * Publish failed: delete (nuke) the release branch. The dispatch branch is
 * never touched, so a rejected publish leaves no version bump behind.
 */
export async function discardReleaseBranch(
  releaseBranch: ReleaseBranch,
): Promise<void> {
  const { branch, env } = releaseBranch
  await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  logger.warn(
    `[release-branch] publish failed — removed ${branch}; ` +
      `${env.mainBranch} untouched.`,
  )
}
