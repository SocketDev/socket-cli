/**
 * @file The `npm-publish-v<version>` branch a CI bump is committed to, and the
 *   pull request that carries it onto the protected release line. The publish
 *   run tags whatever commit that PR's merge leaves at the release line's tip.
 */

import process from 'node:process'

import {
  GithubApiError,
  closeSupersededPullRequests,
  createBranchRef,
  deleteBranchRef,
  upsertPullRequest,
} from './github-api.mts'

import type { PullRequest } from './github-api.mts'

export interface ReleaseEnv {
  // The branch the release PR targets, i.e. the dispatch branch.
  readonly releaseLine: string
  // Repo in `owner/name` form.
  readonly repo: string
  // Release App token with contents:write and pull_requests:write.
  readonly token: string
}

export interface ReleaseBranch {
  readonly branch: string
  // False when the branch already existed, so it may carry an open PR.
  readonly created: boolean
  readonly env: ReleaseEnv
  readonly version: string
}

/**
 * Resolve the CI release environment before any branch is written.
 */
export function resolveReleaseEnv(): ReleaseEnv {
  const repo = process.env['GITHUB_REPOSITORY']
  const releaseLine = process.env['GITHUB_REF_NAME']
  // The release App token minted by the workflow, NOT the default github.token,
  // which stays contents:read for the whole run.
  const token =
    process.env['RELEASE_APP_TOKEN'] || process.env['GH_TOKEN'] || ''
  if (!repo || !releaseLine || !token) {
    const missing = [
      ...(repo ? [] : ['GITHUB_REPOSITORY']),
      ...(releaseLine ? [] : ['GITHUB_REF_NAME']),
      ...(token ? [] : ['RELEASE_APP_TOKEN (or GH_TOKEN)']),
    ]
    throw new Error(
      `[release-branch] the CI bump is missing ${missing.join(', ')}.\n` +
        `  Where: the publish-npm workflow's step env, read before anything is built.\n` +
        `  Wanted: GITHUB_REPOSITORY + GITHUB_REF_NAME, plus a release App token with\n` +
        `  contents:write and pull_requests:write for the branch, commit, and PR.\n` +
        `  Fix: mint the token in the workflow step and pass it as RELEASE_APP_TOKEN.`,
    )
  }
  return { releaseLine, repo, token }
}

/**
 * Branch name for a version, e.g. `npm-publish-v1.1.155`. Predictable and
 * greppable, so a branch stranded by a crashed run is obvious in the branch
 * list.
 */
export function releaseBranchName(version: string): string {
  return `npm-publish-v${version}`
}

export interface OpenReleaseBranchConfig {
  readonly env: ReleaseEnv
  readonly parentSha: string
  readonly version: string
}

/**
 * Create `npm-publish-v<version>` at `parentSha`. A branch left by an earlier
 * run (create returns 422) stays untouched. The caller force-moves it straight
 * to the new commit, so an open PR never sees a head with no diff.
 */
export async function openReleaseBranch(
  config: OpenReleaseBranchConfig,
): Promise<ReleaseBranch> {
  const cfg = { __proto__: null, ...config } as OpenReleaseBranchConfig
  const { env } = cfg
  const branch = releaseBranchName(cfg.version)
  try {
    await createBranchRef({
      branch,
      repo: env.repo,
      sha: cfg.parentSha,
      token: env.token,
    })
  } catch (e) {
    if (!(e instanceof GithubApiError) || e.status !== 422) {
      throw e
    }
    return { branch, created: false, env, version: cfg.version }
  }
  return { branch, created: true, env, version: cfg.version }
}

/**
 * Open (or refresh) the PR that merges the bump into the release line.
 */
export async function openReleasePullRequest(
  releaseBranch: ReleaseBranch,
): Promise<PullRequest> {
  const { branch, env, version } = releaseBranch
  return await upsertPullRequest({
    base: env.releaseLine,
    body: releasePullRequestBody(env.releaseLine, version),
    head: branch,
    repo: env.repo,
    title: `chore(release): ${version}`,
    token: env.token,
  })
}

export function releasePullRequestBody(
  releaseLine: string,
  version: string,
): string {
  return [
    `Bumps package.json to ${version} and moves the \`## [Unreleased]\` notes under the ${version} heading.`,
    '',
    'To release:',
    '',
    '1. Review the CHANGELOG section and squash-merge this PR.',
    `2. Dispatch **Publish to npm registry** on \`${releaseLine}\` with \`dry-run: false\`. It tags the merge commit, cuts the GitHub release, and stages all three packages.`,
    '3. Approve each staged package with `pnpm stage approve`.',
    '',
    `If ${releaseLine} moves before this merges, re-dispatch with \`mode: release-pr\` to rebuild the bump on the new tip.`,
  ].join('\n')
}

/**
 * Close the release PRs for other versions, which a re-dispatch that derives a
 * different version leaves behind.
 */
export async function closeSupersededReleasePullRequests(
  releaseBranch: ReleaseBranch,
): Promise<number[]> {
  const { branch, env } = releaseBranch
  return await closeSupersededPullRequests({
    base: env.releaseLine,
    headPrefix: releaseBranchName(''),
    keepHead: branch,
    repo: env.repo,
    token: env.token,
  })
}

/**
 * Delete the release branch after a failed bump commit.
 */
export async function discardReleaseBranch(
  releaseBranch: ReleaseBranch,
): Promise<void> {
  const { branch, env } = releaseBranch
  await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  process.stdout.write(
    `[release-branch] bump failed, removed ${branch}. ` +
      `${env.releaseLine} untouched.\n`,
  )
}
