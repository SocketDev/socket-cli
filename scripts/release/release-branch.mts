/**
 * @file The throwaway release branch a CI bump lands on, and the two ways it
 *   ends.
 *
 *   The bump commit never lands on the release line directly. It goes to
 *   `npm-publish-v<version>`, and only a run that gets all the way through
 *   staging fast-forwards the release line to that branch tip. A run that fails
 *   anywhere — build, pack, smoke test, tag, stage — deletes the branch instead,
 *   so the release line never sees a version that did not ship.
 *
 *   The landing is a ref fast-forward, not a pull request. A fresh bump branch
 *   has no protected-branch rules to satisfy, so a PR route parks the release
 *   behind checks it can never pass, and there is nothing to review in a
 *   machine-generated bump anyway. The fast-forward also preserves the App's
 *   exact signed SHA — the SHA the release tag already points at — which a
 *   squash would rewrite.
 */

import process from 'node:process'

import {
  GithubApiError,
  createBranchRef,
  deleteBranchRef,
  updateBranchRef,
} from './github-api.mts'

export interface ReleaseEnv {
  // The branch a successful publish fast-forwards, i.e. the dispatch branch.
  readonly releaseLine: string
  // Repo in `owner/name` form.
  readonly repo: string
  // Release App token with contents:write — the branch refs, the bump commit,
  // and the fast-forward that lands it.
  readonly token: string
}

export interface ReleaseBranch {
  readonly branch: string
  readonly env: ReleaseEnv
  readonly version: string
}

/**
 * Resolve the CI release environment. This is the PROMOTE PREFLIGHT: it runs at
 * bump time, before anything is built or staged, so a missing token refuses
 * while nothing has been paid for. Checking at landing time would put the
 * failure after the irreversible registry write, stranding a shipped version on
 * a throwaway branch.
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
        `  Where: the npm-publish workflow's step env, read before anything is built.\n` +
        `  Wanted: GITHUB_REPOSITORY + GITHUB_REF_NAME, plus a release App token with\n` +
        `  contents:write for the branch, the bump commit, and the fast-forward.\n` +
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
 * Create `npm-publish-v<version>` at `parentSha`. Idempotent: a leftover branch
 * from an earlier crashed run (create returns 422) is force-reset to
 * `parentSha`, so this run's commit lands on a clean lineage off the current
 * base.
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
    await updateBranchRef({
      branch,
      force: true,
      repo: env.repo,
      sha: cfg.parentSha,
      token: env.token,
    })
  }
  return { branch, env, version: cfg.version }
}

/**
 * The publish succeeded: fast-forward the release line to the branch tip, then
 * delete the branch. `force` stays false, so GitHub rejects the advance with 422
 * when the release line moved to a commit this one does not descend from.
 *
 * Removing the branch is tidiness, never correctness — the version is already
 * live and already on the release line by then — so a cleanup failure warns
 * instead of failing the run.
 */
export async function promoteReleaseBranch(
  releaseBranch: ReleaseBranch,
  tipSha: string,
): Promise<void> {
  const { branch, env, version } = releaseBranch
  await updateBranchRef({
    branch: env.releaseLine,
    repo: env.repo,
    sha: tipSha,
    token: env.token,
  })
  process.stdout.write(
    `[release-branch] fast-forwarded ${env.releaseLine} to ${tipSha.slice(0, 7)} ` +
      `("chore(release): ${version}") via the release App.\n`,
  )
  try {
    await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  } catch (e) {
    process.stdout.write(
      `[release-branch] ${env.releaseLine} is landed, but removing ${branch} failed: ` +
        `${e instanceof Error ? e.message : String(e)}. Delete it by hand.\n`,
    )
  }
}

/**
 * The publish failed: delete the release branch. The release line is never
 * touched, so a rejected run leaves no version bump behind.
 */
export async function discardReleaseBranch(
  releaseBranch: ReleaseBranch,
): Promise<void> {
  const { branch, env } = releaseBranch
  await deleteBranchRef({ branch, repo: env.repo, token: env.token })
  process.stdout.write(
    `[release-branch] publish failed — removed ${branch}; ` +
      `${env.releaseLine} untouched.\n`,
  )
}
