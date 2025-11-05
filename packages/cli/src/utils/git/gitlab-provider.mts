import { Gitlab } from '@gitbeaker/rest'

import { debug, debugDir } from '@socketsecurity/lib-internal/debug'
import { isNonEmptyString } from '@socketsecurity/lib-internal/strings'

import { formatErrorWithDetail } from '../error/errors.mts'

import type {
  AddCommentOptions,
  CreatePrOptions,
  ListPrsOptions,
  MergeStateStatus,
  PrMatch,
  PrProvider,
  PrResponse,
  UpdatePrOptions,
} from './provider.mts'
import type { MergeRequestSchema } from '@gitbeaker/rest'

/**
 * GitLab provider for Merge Request operations.
 *
 * Implements the PrProvider interface using GitLab's REST API via @gitbeaker/rest.
 */
export class GitLabProvider implements PrProvider {
  private gitlab: InstanceType<typeof Gitlab>

  constructor() {
    const token = getGitLabToken()
    const host = process.env['GITLAB_HOST'] || 'https://gitlab.com'

    this.gitlab = new Gitlab({
      host,
      token,
    })
  }

  async createPr(options: CreatePrOptions): Promise<PrResponse> {
    const { base, body, head, owner, repo, retries = 3, title } = options

    // Get project ID from owner/repo.
    const projectId = `${owner}/${repo}`

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        debugDir({ attempt, base, head, projectId, title })
        // eslint-disable-next-line no-await-in-loop
        const mr = (await this.gitlab.MergeRequests.create(
          projectId,
          head,
          base,
          title,
          {
            description: body,
          },
        )) as MergeRequestSchema

        return {
          number: mr.iid,
          state: mapGitLabState(mr.state),
          url: mr.web_url,
        }
      } catch (e) {
        let message = `Failed to create merge request (attempt ${attempt}/${retries})`
        if (e instanceof Error) {
          message += `: ${e.message}`
        }

        debug(message)
        debugDir(e)

        // Don't retry on validation errors (400).
        if (
          e &&
          typeof e === 'object' &&
          'cause' in e &&
          e.cause &&
          typeof e.cause === 'object' &&
          'response' in e.cause
        ) {
          const response = (e.cause as any).response
          if (response?.status === 400) {
            break
          }
        }

        // Retry on 5xx errors or network failures.
        if (attempt < retries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000)
          debug(`mr: retrying in ${delay}ms...`)
          // eslint-disable-next-line no-await-in-loop
          await sleep(delay)
        }
      }
    }

    throw new Error(
      `Failed to create merge request after ${retries} attempts: ${owner}/${repo}#${head}`,
    )
  }

  async updatePr(options: UpdatePrOptions): Promise<void> {
    const { owner, prNumber, repo } = options

    const projectId = `${owner}/${repo}`

    try {
      // GitLab doesn't have a direct "rebase" endpoint like GitHub's merge.
      // The closest equivalent is to use the rebase API.
      await this.gitlab.MergeRequests.rebase(projectId, prNumber)
      debug(`mr: updating stale MR !${prNumber}`)

      // Check if rebase resulted in conflicts.
      const mr = (await this.gitlab.MergeRequests.show(
        projectId,
        prNumber,
      )) as MergeRequestSchema

      if (mr.merge_status === 'cannot_be_merged') {
        debug(`mr: MR !${prNumber} has conflicts after rebase`)

        // Add comment explaining conflict.
        await this.gitlab.MergeRequestNotes.create(
          projectId,
          prNumber,
          'This MR has merge conflicts after rebasing from the base branch. ' +
            'Please resolve conflicts manually or close this MR and re-run `socket fix` ' +
            'to generate a new fix.',
        )

        debug(`mr: added conflict comment to MR !${prNumber}`)
      }
    } catch (e) {
      throw new Error(
        formatErrorWithDetail(`Failed to update MR !${prNumber}`, e),
      )
    }
  }

  async listPrs(options: ListPrsOptions): Promise<PrMatch[]> {
    const { author, ghsaId, owner, repo, states: statesValue = 'all' } = options
    const checkAuthor = isNonEmptyString(author)
    const matches: PrMatch[] = []
    const projectId = `${owner}/${repo}`

    // Map states to GitLab merge request states.
    const state =
      typeof statesValue === 'string' && statesValue.toLowerCase() !== 'all'
        ? mapStateToGitLab(statesValue)
        : undefined

    try {
      let page = 1
      const perPage = 100
      let hasMore = true

      while (hasMore) {
        // eslint-disable-next-line no-await-in-loop
        const mrs = (await this.gitlab.MergeRequests.all({
          maxPages: 1,
          page,
          perPage,
          projectId,
          ...(state ? { state } : {}),
          ...(checkAuthor ? { authorUsername: author } : {}),
        })) as MergeRequestSchema[]

        for (const mr of mrs) {
          matches.push({
            author: mr.author.username,
            baseRefName: mr.target_branch,
            headRefName: mr.source_branch,
            mergeStateStatus: mapGitLabMergeStatus(mr.merge_status),
            number: mr.iid,
            state: mapGitLabStateToUpper(mr.state),
            title: mr.title,
          })
        }

        // Continue to next page if we got a full page.
        hasMore = mrs.length === perPage
        page += 1

        // Safety limit to prevent infinite loops.
        if (page > 100) {
          debug(
            `REST pagination reached safety limit (100 pages) for ${owner}/${repo}`,
          )
          break
        }

        // Early exit optimization: if we found matches and only looking for specific GHSA,
        // we can stop pagination since we likely found what we need.
        if (matches.length > 0 && ghsaId) {
          break
        }
      }
    } catch (e) {
      debug(`REST pagination failed for ${owner}/${repo}`)
      debugDir(e)
    }

    return matches
  }

  async deleteBranch(branch: string): Promise<boolean> {
    try {
      // GitLab requires project ID to delete a branch.
      // Since we don't have it in this method, we can't delete.
      // This is a limitation of the current interface design.
      debug(`mr: cannot delete branch ${branch} - need project ID in interface`)
      return false
    } catch (e) {
      debug(formatErrorWithDetail(`mr: failed to delete branch ${branch}`, e))
      debugDir(e)
      return false
    }
  }

  async addComment(options: AddCommentOptions): Promise<void> {
    const { body, owner, prNumber, repo } = options
    const projectId = `${owner}/${repo}`

    try {
      await this.gitlab.MergeRequestNotes.create(projectId, prNumber, body)
      debug(`mr: added comment to MR !${prNumber}`)
    } catch (e) {
      throw new Error(
        formatErrorWithDetail(`Failed to add comment to MR !${prNumber}`, e),
      )
    }
  }

  getProviderName(): 'gitlab' {
    return 'gitlab'
  }

  supportsGraphQL(): boolean {
    return false
  }
}

/**
 * Maps GitLab merge request state to common state.
 */
function mapGitLabState(state: string): 'open' | 'closed' | 'merged' {
  if (state === 'opened') {
    return 'open'
  }
  if (state === 'merged') {
    return 'merged'
  }
  return 'closed'
}

/**
 * Maps GitLab merge request state to uppercase common state.
 */
function mapGitLabStateToUpper(state: string): 'OPEN' | 'CLOSED' | 'MERGED' {
  if (state === 'opened') {
    return 'OPEN'
  }
  if (state === 'merged') {
    return 'MERGED'
  }
  return 'CLOSED'
}

/**
 * Maps common state to GitLab state.
 */
function mapStateToGitLab(state: string): 'opened' | 'closed' | 'merged' {
  const lower = state.toLowerCase()
  if (lower === 'open') {
    return 'opened'
  }
  if (lower === 'merged') {
    return 'merged'
  }
  return 'closed'
}

/**
 * Maps GitLab merge_status to common merge state status.
 */
function mapGitLabMergeStatus(status: string): MergeStateStatus {
  // GitLab merge_status values:
  // - can_be_merged: clean, no conflicts
  // - cannot_be_merged: has conflicts
  // - unchecked: not yet checked
  // - checking: currently checking
  // - cannot_be_merged_recheck: needs recheck
  switch (status) {
    case 'can_be_merged':
      return 'CLEAN'
    case 'cannot_be_merged':
    case 'cannot_be_merged_recheck':
      return 'DIRTY'
    case 'checking':
    case 'unchecked':
      return 'UNKNOWN'
    default:
      return 'UNKNOWN'
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Gets the GitLab API token from environment or git config.
 *
 * Priority:
 * 1. GITLAB_TOKEN environment variable
 * 2. git config gitlab.token
 * 3. Error if not found
 */
function getGitLabToken(): string {
  // Check environment variable.
  const envToken = process.env['GITLAB_TOKEN']
  if (envToken) {
    return envToken
  }

  // TODO: Check git config in Phase 3.
  // For now, require environment variable.
  throw new Error(
    'GitLab token not found. Set GITLAB_TOKEN environment variable.',
  )
}
