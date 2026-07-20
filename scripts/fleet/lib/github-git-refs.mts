/**
 * @file GitHub git-refs REST helpers — create, fast-forward, and delete a branch
 *   ref. The publish pipeline's branch-based bump uses these: bump commits land
 *   on a throwaway `<channel>-publish-v<version>` branch, and only a SUCCESSFUL
 *   publish fast-forwards `main` to that branch tip (same SHA) then deletes it.
 *   A rejected publish deletes the branch, so `main` never sees the bump — no
 *   version creep, and no direct write to a branch-protected `main`. `httpJson`
 *   throws `HttpResponseError` on non-2xx and JSON-parses the body; a `DELETE`
 *   ref returns 204 with an empty body, so that path uses `httpText`. All three
 *   go over node:http, so nock intercepts them in tests.
 */

import {
  HttpResponseError,
  httpJson,
  httpText,
} from '@socketsecurity/lib-stable/http-request'

const DEFAULT_API_URL = 'https://api.github.com'

export interface GitRefOptions {
  // Override the API origin (GitHub Enterprise / tests). Defaults to api.github.com.
  readonly apiUrl?: string | undefined
  // Short branch name without the `refs/heads/` prefix (e.g. 'npm-publish-v1.4.3').
  readonly branch: string
  // Repo in "owner/name" form.
  readonly repo: string
  // GitHub token with contents:write (the release App token in CI).
  readonly token: string
}

export interface CreateOrUpdateRefOptions extends GitRefOptions {
  // Optional for `updateBranchRef`: allow a non-fast-forward advance. Defaults to
  // false so GitHub rejects (422) anything that would rewrite history.
  readonly force?: boolean | undefined
  // Commit SHA the ref should point at.
  readonly sha: string
}

function refHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  }
}

/**
 * Create `refs/heads/<branch>` pointing at `sha`. Throws `HttpResponseError` on
 * a non-2xx response — including 422 when the ref already exists (the caller
 * decides whether to force-update it instead).
 */
export async function createBranchRef(
  options: CreateOrUpdateRefOptions,
): Promise<void> {
  const opts = { __proto__: null, ...options } as CreateOrUpdateRefOptions
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  await httpJson(`${apiUrl}/repos/${opts.repo}/git/refs`, {
    body: JSON.stringify({ ref: `refs/heads/${opts.branch}`, sha: opts.sha }),
    headers: refHeaders(opts.token),
    method: 'POST',
    timeout: 30_000,
  })
}

/**
 * Advance `refs/heads/<branch>` to `sha`. With `force` false (the default) a
 * non-fast-forward advance is rejected by GitHub (422) — the fast-forward is
 * what lets `main` inherit the release branch's exact commit SHA. Throws
 * `HttpResponseError` on any non-2xx response.
 */
export async function updateBranchRef(
  options: CreateOrUpdateRefOptions,
): Promise<void> {
  const opts = { __proto__: null, ...options } as CreateOrUpdateRefOptions
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  await httpJson(`${apiUrl}/repos/${opts.repo}/git/refs/heads/${opts.branch}`, {
    body: JSON.stringify({ force: opts.force ?? false, sha: opts.sha }),
    headers: refHeaders(opts.token),
    method: 'PATCH',
    timeout: 30_000,
  })
}

/**
 * Delete `refs/heads/<branch>`. Idempotent: a 404/422 (the ref is already gone)
 * is swallowed so cleanup after a failed or re-run publish never itself throws.
 * Any other non-2xx (e.g. 401/403 auth) propagates.
 */
export async function deleteBranchRef(options: GitRefOptions): Promise<void> {
  const opts = { __proto__: null, ...options } as GitRefOptions
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  try {
    await httpText(
      `${apiUrl}/repos/${opts.repo}/git/refs/heads/${opts.branch}`,
      {
        headers: refHeaders(opts.token),
        method: 'DELETE',
        timeout: 30_000,
      },
    )
  } catch (e) {
    const status =
      e instanceof HttpResponseError ? e.response.status : undefined
    if (status !== 404 && status !== 422) {
      throw e
    }
  }
}
