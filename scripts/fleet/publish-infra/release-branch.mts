/**
 * @file Registry-agnostic release-branch orchestration for the CI publish path.
 *   The version bump commits land on a throwaway `<channel>-publish-v<version>`
 *   branch instead of directly on `main`; only a SUCCESSFUL publish lands that
 *   branch on `main` — through a PULL REQUEST with squash auto-merge, so a
 *   branch-protected `main` (which rejects a direct ref push from the release
 *   App with 422 "changes must be made through a pull request") is advanced
 *   without a push-bypass. A FAILED publish deletes the branch so `main` is
 *   never touched — no version creep, and safe when `main` is branch-protected.
 *   Shared by the npm + cargo bump tiers (both accumulate their commit(s) on
 *   the branch this opens).
 */

import process from 'node:process'

import { HttpResponseError } from '@socketsecurity/lib-stable/http-request'

import {
  createBranchRef,
  deleteBranchRef,
  updateBranchRef,
} from '../lib/github-git-refs.mts'
import {
  createPullRequest,
  enablePullRequestAutoMerge,
  mergePullRequest,
} from '../lib/github-pull-requests.mts'
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
  // The version this branch bumps to — pins the promote PR's squash subject to
  // `chore: bump version to <version>` (the reconcile anchor) and titles the PR.
  readonly version: string
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
export async function openReleaseBranch(config: {
  channel: string
  env: ReleaseEnv
  parentSha: string
  version: string
}): Promise<ReleaseBranch> {
  const cfg = { __proto__: null, ...config } as {
    channel: string
    env: ReleaseEnv
    parentSha: string
    version: string
  }
  const { env } = cfg
  const branch = releaseBranchName(cfg.channel, cfg.version)
  try {
    await createBranchRef({
      branch,
      repo: env.repo,
      sha: cfg.parentSha,
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
      sha: cfg.parentSha,
      token: env.token,
    })
  }
  logger.log(
    `[release-branch] opened ${branch} at ${cfg.parentSha.slice(0, 7)}.`,
  )
  return { branch, env, version: cfg.version }
}

/**
 * Publish succeeded: land the release branch's bump commit on the dispatch
 * branch through a PULL REQUEST, not a direct ref push. A branch-protected
 * `main` that requires "changes must be made through a pull request" rejects a
 * direct fast-forward PATCH with 422 (the release App is NOT on main's
 * push-bypass allowlist), which used to force a maintainer to hand-land every
 * bump. Opening a PR from the release branch and enabling squash auto-merge
 * works WITHIN branch protection — no bypass needed.
 *
 * The squash commit subject is pinned to `chore: bump version to <version>`
 * (the same subject the bump commit carries) so the reconcile anchor survives
 * the squash — `findPublishedBaseSha` / the version-flip anchor lookups keep
 * resolving the landed bump. Branch protection typically permits only a squash
 * merge (linear history), so the release App's exact app-signed commit SHA is
 * not preserved verbatim; the squashed commit is created under the release App
 * and GitHub-signed (Verified), carrying byte-identical bump content.
 *
 * `tipSha` is the built + published commit (informational — used for the log
 * line; the PR head branch already points at it). When auto-merge cannot be
 * enabled because the PR is already mergeable with nothing to wait on, the
 * merge is performed immediately. The release branch is auto-deleted on merge
 * (repos set `delete_branch_on_merge`); it is deliberately NOT deleted here,
 * since deleting it before the merge would close the PR.
 */
export async function promoteReleaseBranch(
  releaseBranch: ReleaseBranch,
  tipSha: string,
): Promise<void> {
  const { branch, env, version } = releaseBranch
  const commitSubject = `chore: bump version to ${version}`
  const pr = await createPullRequest({
    base: env.mainBranch,
    body:
      `Automated version bump to \`${version}\` from the publish pipeline, ` +
      `landed via PR because \`${env.mainBranch}\` requires changes go through ` +
      `a pull request. The version is already live on the registry; this ` +
      `advances \`${env.mainBranch}\` to the bump commit (${tipSha.slice(0, 7)}).`,
    head: branch,
    repo: env.repo,
    title: commitSubject,
    token: env.token,
  })
  const queued = await enablePullRequestAutoMerge({
    commitHeadline: commitSubject,
    pullRequestId: pr.nodeId,
    repo: env.repo,
    token: env.token,
  })
  if (queued) {
    logger.success(
      `[release-branch] opened PR #${pr.number} (${branch} → ${env.mainBranch}) ` +
        `and enabled squash auto-merge; ${env.mainBranch} advances when its ` +
        `branch-protection requirements clear.`,
    )
    return
  }
  // Nothing to wait on — merge now.
  await mergePullRequest({
    commitTitle: commitSubject,
    number: pr.number,
    repo: env.repo,
    token: env.token,
  })
  logger.success(
    `[release-branch] opened PR #${pr.number} (${branch} → ${env.mainBranch}) ` +
      `and squash-merged it into ${env.mainBranch}.`,
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
