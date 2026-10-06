/**
 * @file The GitHub REST calls the release flow needs: branch refs, a signed
 *   commit built out of git objects (blob → tree → commit → ref), and the
 *   release pull request.
 *
 *   A commit created through the API is web-flow VERIFIED without a local GPG or
 *   SSH key, which is the only way CI can land a commit on a branch that
 *   requires signed commits. Everything goes over global `fetch` with no
 *   dependencies, so this runs before (or entirely without) an install.
 */

const DEFAULT_API_URL = 'https://api.github.com'

export class GithubApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'GithubApiError'
    this.status = status
  }
}

export interface GithubRequestConfig {
  // Override the API origin (GitHub Enterprise, tests). Defaults to api.github.com.
  readonly apiUrl?: string | undefined
  readonly body?: unknown | undefined
  readonly method: string
  // Path below the API origin, e.g. `/repos/owner/name/git/refs`.
  readonly path: string
  // The release App installation token in CI.
  readonly token: string
}

/**
 * One GitHub REST call. Returns the parsed JSON body, or undefined for a 204.
 * Throws `GithubApiError` carrying the status on any non-2xx, so callers can
 * branch on 422 (ref exists) and 404 (ref gone) without string matching.
 */
export async function githubRequest<T>(
  config: GithubRequestConfig,
): Promise<T | undefined> {
  const cfg = { __proto__: null, ...config } as GithubRequestConfig
  const apiUrl = cfg.apiUrl ?? DEFAULT_API_URL
  const response = await fetch(`${apiUrl}${cfg.path}`, {
    ...(cfg.body === undefined ? {} : { body: JSON.stringify(cfg.body) }),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
      'user-agent': 'socket-cli-release',
      'x-github-api-version': '2022-11-28',
    },
    method: cfg.method,
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new GithubApiError(
      response.status,
      `GitHub ${cfg.method} ${cfg.path} failed with ${response.status}: ${text}`,
    )
  }
  return text ? (JSON.parse(text) as T) : undefined
}

export interface BranchRefConfig {
  readonly apiUrl?: string | undefined
  // Short branch name, no `refs/heads/` prefix.
  readonly branch: string
  // Repo in `owner/name` form.
  readonly repo: string
  readonly token: string
}

export interface WriteBranchRefConfig extends BranchRefConfig {
  // Allow a non-fast-forward advance. Defaults to false so GitHub rejects
  // (422) anything that would rewrite history.
  readonly force?: boolean | undefined
  readonly sha: string
}

/**
 * Create `refs/heads/<branch>` at `sha`. Throws `GithubApiError` with status 422
 * when the ref already exists, which the caller treats as "reset it instead".
 */
export async function createBranchRef(
  config: WriteBranchRefConfig,
): Promise<void> {
  const cfg = { __proto__: null, ...config } as WriteBranchRefConfig
  await githubRequest({
    apiUrl: cfg.apiUrl,
    body: { ref: `refs/heads/${cfg.branch}`, sha: cfg.sha },
    method: 'POST',
    path: `/repos/${cfg.repo}/git/refs`,
    token: cfg.token,
  })
}

/**
 * Advance `refs/heads/<branch>` to `sha`. With `force` false, the default,
 * GitHub rejects a non-fast-forward advance with 422.
 */
export async function updateBranchRef(
  config: WriteBranchRefConfig,
): Promise<void> {
  const cfg = { __proto__: null, ...config } as WriteBranchRefConfig
  await githubRequest({
    apiUrl: cfg.apiUrl,
    body: { force: cfg.force ?? false, sha: cfg.sha },
    method: 'PATCH',
    path: `/repos/${cfg.repo}/git/refs/heads/${cfg.branch}`,
    token: cfg.token,
  })
}

/**
 * Delete `refs/heads/<branch>`. Idempotent — a 404 or 422 means the ref is
 * already gone, so cleanup after a failed run never itself fails. Any other
 * non-2xx (an auth problem, say) propagates.
 */
export async function deleteBranchRef(config: BranchRefConfig): Promise<void> {
  const cfg = { __proto__: null, ...config } as BranchRefConfig
  try {
    await githubRequest({
      apiUrl: cfg.apiUrl,
      method: 'DELETE',
      path: `/repos/${cfg.repo}/git/refs/heads/${cfg.branch}`,
      token: cfg.token,
    })
  } catch (e) {
    const status = e instanceof GithubApiError ? e.status : undefined
    if (status !== 404 && status !== 422) {
      throw e
    }
  }
}

export interface CommitFile {
  // UTF-8 text to write at `path`.
  readonly content: string
  // Repo-relative path with POSIX separators, e.g. `package.json`.
  readonly path: string
}

export interface CommitViaGithubApiConfig {
  readonly apiUrl?: string | undefined
  // SHA of the tree to layer the new files onto, usually `HEAD^{tree}`.
  readonly baseTreeSha: string
  readonly branch: string
  readonly files: readonly CommitFile[]
  readonly message: string
  // Parent commit SHA, usually `HEAD`.
  readonly parentSha: string
  readonly repo: string
  readonly token: string
}

/**
 * Build blob → tree → commit and advance `branch` to the new commit. Returns the
 * new (verified) commit SHA. The caller then resets its checkout to that SHA so
 * the rest of the run builds the exact commit it will publish.
 */
export async function commitViaGithubApi(
  config: CommitViaGithubApiConfig,
): Promise<string> {
  const cfg = { __proto__: null, ...config } as CommitViaGithubApiConfig
  const gitPath = `/repos/${cfg.repo}/git`
  const tree: Array<{
    mode: string
    path: string
    sha: string
    type: string
  }> = []
  for (let i = 0, { length } = cfg.files; i < length; i += 1) {
    const file = cfg.files[i]!
    // eslint-disable-next-line no-await-in-loop
    const blob = await githubRequest<{ sha: string }>({
      apiUrl: cfg.apiUrl,
      body: {
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      },
      method: 'POST',
      path: `${gitPath}/blobs`,
      token: cfg.token,
    })
    tree.push({
      mode: '100644',
      path: file.path,
      sha: blob!.sha,
      type: 'blob',
    })
  }
  const newTree = await githubRequest<{ sha: string }>({
    apiUrl: cfg.apiUrl,
    body: { base_tree: cfg.baseTreeSha, tree },
    method: 'POST',
    path: `${gitPath}/trees`,
    token: cfg.token,
  })
  const commit = await githubRequest<{ sha: string }>({
    apiUrl: cfg.apiUrl,
    body: {
      message: cfg.message,
      parents: [cfg.parentSha],
      tree: newTree!.sha,
    },
    method: 'POST',
    path: `${gitPath}/commits`,
    token: cfg.token,
  })
  await updateBranchRef({
    apiUrl: cfg.apiUrl,
    branch: cfg.branch,
    repo: cfg.repo,
    sha: commit!.sha,
    token: cfg.token,
  })
  return commit!.sha
}

export interface PullRequest {
  readonly html_url: string
  readonly number: number
}

export interface ReleasePullRequestConfig {
  readonly apiUrl?: string | undefined
  // Branch the PR merges into.
  readonly base: string
  readonly body: string
  // Branch the PR merges from, in the same repository.
  readonly head: string
  readonly repo: string
  readonly title: string
  readonly token: string
}

/**
 * Open a PR from `head` into `base`, or return the open one that already
 * exists for that pair. A re-run force-resets `head`, so the existing PR picks
 * up the new commit by itself and only its title and body need refreshing.
 */
export async function upsertPullRequest(
  config: ReleasePullRequestConfig,
): Promise<PullRequest> {
  const cfg = { __proto__: null, ...config } as ReleasePullRequestConfig
  const owner = cfg.repo.split('/')[0]
  const query = new URLSearchParams({
    base: cfg.base,
    head: `${owner}:${cfg.head}`,
    state: 'open',
  })
  const existing = await githubRequest<PullRequest[]>({
    apiUrl: cfg.apiUrl,
    method: 'GET',
    path: `/repos/${cfg.repo}/pulls?${query}`,
    token: cfg.token,
  })
  const open = existing?.[0]
  if (open) {
    const updated = await githubRequest<PullRequest>({
      apiUrl: cfg.apiUrl,
      body: { body: cfg.body, title: cfg.title },
      method: 'PATCH',
      path: `/repos/${cfg.repo}/pulls/${open.number}`,
      token: cfg.token,
    })
    return updated!
  }
  const created = await githubRequest<PullRequest>({
    apiUrl: cfg.apiUrl,
    body: {
      base: cfg.base,
      body: cfg.body,
      head: cfg.head,
      title: cfg.title,
    },
    method: 'POST',
    path: `/repos/${cfg.repo}/pulls`,
    token: cfg.token,
  })
  return created!
}
