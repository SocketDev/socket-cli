/**
 * @file GitHub pull-request REST + GraphQL helpers — open a PR, enable
 *   squash auto-merge, and (fallback) merge it now. The publish pipeline's
 *   branch-based promote uses these instead of a direct fast-forward PATCH of
 *   `main`: a branch-protected `main` that requires "changes must be made
 *   through a pull request" rejects the direct ref PATCH with 422, so the
 *   release App (which is NOT on main's push-bypass allowlist) can never
 *   advance `main` by hand. Routing the promote through a PR + auto-merge works
 *   WITHIN branch protection — no bypass needed. `createPullRequest` is
 *   idempotent (a leftover open PR from a re-run is reused, not duplicated).
 *   `enablePullRequestAutoMerge` is GraphQL, the only auto-merge surface;
 *   `mergePullRequest` is the REST fallback for the "already mergeable, nothing
 *   to wait on" case where GitHub refuses to enable auto-merge. All calls go
 *   over node:http (httpJson), so nock intercepts them in tests.
 */

import {
  httpJson,
  HttpResponseError,
} from '@socketsecurity/lib-stable/http-request'

const DEFAULT_API_URL = 'https://api.github.com'

// GitHub's auto-merge-enable mutation refuses when the PR is ALREADY in a
// mergeable ("clean") state with nothing to wait on — there is no pending
// requirement to merge-when-satisfied against. This is the sentinel the
// mutation returns in that case; the caller falls back to an immediate merge.
const AUTO_MERGE_CLEAN_STATUS = 'Pull request is in clean status'

export interface PullRequestApiConfig {
  // Override the API origin (GitHub Enterprise / tests). Defaults to api.github.com.
  readonly apiUrl?: string | undefined
  // Repo in "owner/name" form.
  readonly repo: string
  // GitHub token with pull_requests:write (the release App token in CI).
  readonly token: string
}

export interface CreatePullRequestConfig extends PullRequestApiConfig {
  // Target branch the PR merges into (e.g. 'main').
  readonly base: string
  // PR body (markdown).
  readonly body: string
  // Source branch holding the commit(s) to merge (e.g. 'npm-publish-v1.4.3').
  readonly head: string
  // PR title.
  readonly title: string
}

export interface OpenPullRequest {
  // The PR's GraphQL node id — required to enable auto-merge.
  readonly nodeId: string
  // The PR number (for the REST merge fallback + logging).
  readonly number: number
}

export interface EnableAutoMergeConfig extends PullRequestApiConfig {
  // The squash commit subject. Pinned to the bump subject so the reconcile
  // anchor (`chore: bump version to <version>`) survives the squash.
  readonly commitHeadline: string
  // The PR's GraphQL node id (from createPullRequest).
  readonly pullRequestId: string
}

export interface MergePullRequestConfig extends PullRequestApiConfig {
  // The squash commit subject (same value as EnableAutoMergeConfig.commitHeadline).
  readonly commitTitle: string
  // The PR number (from createPullRequest).
  readonly number: number
}

function restHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  }
}

/**
 * Open a PR from `head` into `base`. Idempotent: a re-run whose branch already
 * has an open PR (create returns 422 "A pull request already exists") reuses
 * that PR instead of failing, so a retried promote never duplicates it. Returns
 * the PR number + GraphQL node id. Throws `HttpResponseError` on any other
 * non-2xx.
 */
export async function createPullRequest(
  config: CreatePullRequestConfig,
): Promise<OpenPullRequest> {
  const cfg = { __proto__: null, ...config } as CreatePullRequestConfig
  const apiUrl = cfg.apiUrl ?? DEFAULT_API_URL
  try {
    const pr = await httpJson<{ node_id: string; number: number }>(
      `${apiUrl}/repos/${cfg.repo}/pulls`,
      {
        body: JSON.stringify({
          base: cfg.base,
          body: cfg.body,
          head: cfg.head,
          maintainer_can_modify: false,
          title: cfg.title,
        }),
        headers: restHeaders(cfg.token),
        method: 'POST',
        timeout: 30_000,
      },
    )
    return { nodeId: pr.node_id, number: pr.number }
  } catch (e) {
    const status =
      e instanceof HttpResponseError ? e.response.status : undefined
    if (status !== 422) {
      throw e
    }
    // A PR for this head already exists, a re-run — find + reuse it.
    const owner = cfg.repo.slice(0, cfg.repo.indexOf('/'))
    const existing = await httpJson<Array<{ node_id: string; number: number }>>(
      `${apiUrl}/repos/${cfg.repo}/pulls?head=${encodeURIComponent(
        `${owner}:${cfg.head}`,
      )}&base=${encodeURIComponent(cfg.base)}&state=open`,
      {
        headers: restHeaders(cfg.token),
        method: 'GET',
        timeout: 30_000,
      },
    )
    const found = existing[0]
    if (!found) {
      throw e
    }
    return { nodeId: found.node_id, number: found.number }
  }
}

/**
 * Enable SQUASH auto-merge on a PR, so GitHub merges it the moment its branch-
 * protection requirements clear, required review, checks — no push-bypass and
 * no local wait. `commitHeadline` pins the squash commit subject so the bump
 * subject, the reconcile anchor, survives. Auto-merge is a GraphQL-only
 * surface. Returns `false`, never throws, when GitHub refuses because the PR is
 * already in a clean/mergeable state with nothing to wait on — the caller then
 * merges immediately via `mergePullRequest`. Throws on any other GraphQL
 * error.
 */
export async function enablePullRequestAutoMerge(
  config: EnableAutoMergeConfig,
): Promise<boolean> {
  const cfg = { __proto__: null, ...config } as EnableAutoMergeConfig
  const apiUrl = cfg.apiUrl ?? DEFAULT_API_URL
  const graphqlUrl = `${apiUrl}/graphql`
  const query = `mutation($id: ID!, $headline: String!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $id,
      mergeMethod: SQUASH,
      commitHeadline: $headline
    }) { clientMutationId }
  }`
  const result = await httpJson<{
    errors?: Array<{ message: string }> | undefined
  }>(graphqlUrl, {
    body: JSON.stringify({
      query,
      variables: { headline: cfg.commitHeadline, id: cfg.pullRequestId },
    }),
    headers: restHeaders(cfg.token),
    method: 'POST',
    timeout: 30_000,
  })
  const errors = result.errors
  if (errors?.length) {
    // "Clean status" is expected for a PR with no pending requirement to wait
    // on — signal the caller to merge now rather than treat it as a failure.
    if (errors.some(err => err.message.includes(AUTO_MERGE_CLEAN_STATUS))) {
      return false
    }
    throw new Error(
      `[github-pull-requests] enablePullRequestAutoMerge failed: ${errors
        .map(err => err.message)
        .join('; ')}`,
    )
  }
  return true
}

/**
 * Merge a PR NOW via REST, squashing to a single commit whose subject is
 * `commitTitle`, the bump subject. The immediate-merge fallback for when
 * auto-merge can't be enabled, nothing to wait on. Throws `HttpResponseError`
 * on a non-2xx (e.g. a required review the App can't satisfy — a real block the
 * operator must resolve, surfaced loud).
 */
export async function mergePullRequest(
  config: MergePullRequestConfig,
): Promise<void> {
  const cfg = { __proto__: null, ...config } as MergePullRequestConfig
  const apiUrl = cfg.apiUrl ?? DEFAULT_API_URL
  await httpJson(`${apiUrl}/repos/${cfg.repo}/pulls/${cfg.number}/merge`, {
    body: JSON.stringify({
      commit_title: cfg.commitTitle,
      merge_method: 'squash',
    }),
    headers: restHeaders(cfg.token),
    method: 'PUT',
    timeout: 30_000,
  })
}
