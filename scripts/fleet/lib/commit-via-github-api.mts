/**
 * @file Create a SIGNED commit on a branch via the GitHub git-objects API (blob
 *   -> tree -> commit -> ref PATCH). Commits created through the API are
 *   web-flow-verified ("Verified" / signed) WITHOUT a local GPG or SSH signing
 *   key — the only way CI can land a commit on a branch whose protection
 *   requires signed commits (the fleet rule: commits on main must be signed,
 *   and CI has no signing key). The provenance workflow's bump stage uses this
 *   to commit the version bump (package.json + CHANGELOG.md); socket-registry's
 *   local workflow reuses it for its monorepo bump. Generalizes the inline
 *   "Commit lockfile if updated" step to N files and makes it unit-testable
 *   (httpJson on Node uses node:http, so nock intercepts it). Pure of git: the
 *   caller passes the parent commit + base tree SHAs (from `git rev-parse HEAD`
 *   / `git rev-parse HEAD^{tree}`); this only talks to the API. After it
 *   returns the new commit SHA the caller resets its checkout to it (`git
 *   fetch` + `git reset --hard`).
 */

import { httpJson } from '@socketsecurity/lib-stable/http-request'

import { updateBranchRef } from './github-git-refs.mts'

const DEFAULT_API_URL = 'https://api.github.com'

export interface CommitFile {
  // UTF-8 text contents to write at `path`.
  readonly content: string
  // Repo-relative path, POSIX separators (e.g. 'package.json').
  readonly path: string
}

export interface CommitViaGithubApiOptions {
  // Override the API origin (GitHub Enterprise / tests). Defaults to api.github.com.
  readonly apiUrl?: string | undefined
  // SHA of the tree to layer the new files onto (usually `HEAD^{tree}`).
  readonly baseTreeSha: string
  // Branch to advance (e.g. 'main').
  readonly branch: string
  // Files to write in the commit.
  readonly files: readonly CommitFile[]
  // Commit message.
  readonly message: string
  // Parent commit SHA (usually `HEAD`).
  readonly parentSha: string
  // Repo in "owner/name" form.
  readonly repo: string
  // GitHub token (CI: github.token / GH_TOKEN).
  readonly token: string
}

/**
 * Build blob -> tree -> commit and advance `branch` to the new commit. Returns
 * the new (verified) commit SHA. Throws on any non-2xx API response.
 */
export async function commitViaGithubApi(
  options: CommitViaGithubApiOptions,
): Promise<string> {
  const opts = { __proto__: null, ...options } as CommitViaGithubApiOptions
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  const git = `${apiUrl}/repos/${opts.repo}/git`
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${opts.token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  }
  function post<T>(resource: string, body: unknown): Promise<T> {
    return httpJson<T>(`${git}/${resource}`, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
      timeout: 30_000,
    })
  }

  // 1. One blob per file (base64 so binary-safe).
  const tree: Array<{
    mode: string
    path: string
    sha: string
    type: string
  }> = []
  for (let i = 0, { length } = opts.files; i < length; i += 1) {
    const file = opts.files[i]!
    // oxlint-disable-next-line no-await-in-loop -- blobs must exist before the tree references them; the file count is tiny (a bump touches 1-2 files).
    const blob = await post<{ sha: string }>('blobs', {
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      encoding: 'base64',
    })
    tree.push({ mode: '100644', path: file.path, sha: blob.sha, type: 'blob' })
  }

  // 2. Tree layered on the base tree.
  const newTree = await post<{ sha: string }>('trees', {
    base_tree: opts.baseTreeSha,
    tree,
  })

  // 3. Commit (API-created => verified/signed).
  const commit = await post<{ sha: string }>('commits', {
    message: opts.message,
    parents: [opts.parentSha],
    tree: newTree.sha,
  })

  // 4. Fast-forward the branch ref to the new commit.
  await updateBranchRef({
    apiUrl,
    branch: opts.branch,
    repo: opts.repo,
    sha: commit.sha,
    token: opts.token,
  })

  return commit.sha
}
