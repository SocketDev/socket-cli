/**
 * @file Registry-agnostic release-branch orchestration for the CI publish path.
 *   The version bump commits land on a throwaway `<channel>-publish-v<version>`
 *   branch instead of directly on `main`; only a SUCCESSFUL publish lands that
 *   branch on `main` — by fast-forwarding `main`'s ref to the branch tip with
 *   the release App's contents:write token, then deleting the branch. A version
 *   bump NEVER travels through a pull request: the PR route parks the release
 *   behind branch-protection requirements the fresh branch cannot satisfy, and
 *   there is nothing to review in a machine-generated bump. A FAILED publish
 *   deletes the branch so `main` is never touched — no version creep. Shared by
 *   the npm + cargo bump tiers (both accumulate their commit(s) on the branch
 *   this opens).
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
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
  // Release App token with contents:write — branch refs, the bump commit, and
  // the fast-forward that lands it on the dispatch branch.
  readonly token: string
}

export interface ReleaseBranch {
  // The `<channel>-publish-v<version>` branch holding this run's bump commit(s).
  readonly branch: string
  // The resolved CI release environment.
  readonly env: ReleaseEnv
  // The version this branch bumps to — names the `chore: bump version to
  // <version>` commit the reconcile lookups anchor on.
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
 * token). Throws loud — What / Where / Saw vs. wanted / Fix — when any piece is
 * missing.
 *
 * This is the PROMOTE PREFLIGHT. It runs at bump time, before anything is
 * staged or published, so a missing token refuses while nothing has been paid
 * for — checking at promote time would be AFTER the irreversible registry
 * publish, where the failure strands a live version on a throwaway branch.
 */
export function resolveReleaseEnv(): ReleaseEnv {
  const repo = process.env['GITHUB_REPOSITORY']
  const mainBranch = process.env['GITHUB_REF_NAME']
  // The in-house release App token, minted by the workflow's app-token action,
  // NOT the default github.token — least-privilege + verified/app-attributed.
  const token =
    process.env['RELEASE_APP_TOKEN'] || process.env['GH_TOKEN'] || ''
  const missing = [
    ...(repo ? [] : ['GITHUB_REPOSITORY']),
    ...(mainBranch ? [] : ['GITHUB_REF_NAME']),
    ...(token ? [] : ['RELEASE_APP_TOKEN (or GH_TOKEN)']),
  ]
  if (!repo || !mainBranch || !token) {
    throw new Error(
      `[release-branch] the CI bump is missing ${missing.join(', ')}.\n` +
        `  Where: the publish workflow's step env, read before anything is staged.\n` +
        `  Wanted: GITHUB_REPOSITORY + GITHUB_REF_NAME and a release App token\n` +
        `  (contents:write — the branch, the bump commit, and the fast-forward\n` +
        `  that lands it on the default branch).\n` +
        `  Fix: mint it in the workflow — ./.github/actions/fleet/github-release-app-token\n` +
        `  — and pass it as RELEASE_APP_TOKEN on the publish step.`,
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
 * branch by fast-forwarding that branch's ref to the release branch tip, then
 * delete the release branch. NO pull request — a version bump never travels
 * through one. A PR routes the bump through branch protection, where the fresh
 * bump branch has no protected-branch rules to satisfy, so auto-merge fails
 * ("Pull request Branch does not have required protected branch rules"), the
 * run dies, and the published version is stranded on a throwaway branch. The
 * release App carries contents:write and sits on the dispatch branch's
 * push-bypass allowlist, so the ref PATCH lands without a PR.
 *
 * The direct fast-forward also preserves the release App's exact app-signed
 * commit SHA — the dispatch branch inherits the very commit that was built and
 * published, and the `chore: bump version to <version>` subject the reconcile
 * lookups anchor on (`findPublishedBaseSha`, the version-flip lookups) survives
 * verbatim rather than being rewritten by a squash.
 *
 * `tipSha` is the built + published commit. `force` stays false, so GitHub
 * rejects the advance with 422 if the dispatch branch moved to a commit this
 * one does not descend from — a loud refusal beats silently rewriting work that
 * landed during the publish.
 */
export async function promoteReleaseBranch(
  releaseBranch: ReleaseBranch,
  tipSha: string,
): Promise<void> {
  const { branch, env, version } = releaseBranch
  await updateBranchRef({
    branch: env.mainBranch,
    repo: env.repo,
    sha: tipSha,
    token: env.token,
  })
  logger.success(
    `[release-branch] fast-forwarded ${env.mainBranch} to ${tipSha.slice(0, 7)} ` +
      `("chore: bump version to ${version}") via the release App.`,
  )
  // The bump is landed; a leftover throwaway branch is untidy, never wrong. Warn
  // rather than throw, so a cleanup permission problem can't fail a run whose
  // version is already published AND on the dispatch branch.
  try {
    await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  } catch (e) {
    logger.warn(
      `[release-branch] ${env.mainBranch} is landed, but removing ${branch} ` +
        `failed: ${errorMessage(e)}. Delete it by hand.`,
    )
  }
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
