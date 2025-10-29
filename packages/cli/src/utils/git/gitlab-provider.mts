import { Gitlab } from '@gitbeaker/rest'

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

/**
 * GitLab provider for Merge Request operations.
 *
 * Implements the PrProvider interface using GitLab's REST API via @gitbeaker/rest.
 */
export class GitLabProvider implements PrProvider {
  private gitlab: InstanceType<typeof Gitlab>

  constructor() {
    const token = getGitLabToken()
    const host = process.env.GITLAB_HOST || 'https://gitlab.com'

    this.gitlab = new Gitlab({
      token,
      host,
    })
  }

  async createPr(options: CreatePrOptions): Promise<PrResponse> {
    // TODO: Implement in Phase 3.
    throw new Error('GitLab MR creation not yet implemented')
  }

  async updatePr(options: UpdatePrOptions): Promise<void> {
    // TODO: Implement in Phase 3.
    throw new Error('GitLab MR update not yet implemented')
  }

  async listPrs(options: ListPrsOptions): Promise<PrMatch[]> {
    // TODO: Implement in Phase 3.
    throw new Error('GitLab MR listing not yet implemented')
  }

  async deleteBranch(branch: string): Promise<boolean> {
    // TODO: Implement in Phase 3.
    throw new Error('GitLab branch deletion not yet implemented')
  }

  async addComment(options: AddCommentOptions): Promise<void> {
    // TODO: Implement in Phase 3.
    throw new Error('GitLab MR comments not yet implemented')
  }

  getProviderName(): 'gitlab' {
    return 'gitlab'
  }

  supportsGraphQL(): boolean {
    // GitLab has GraphQL but we're using REST API for simplicity.
    return false
  }
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
  const envToken = process.env.GITLAB_TOKEN
  if (envToken) {
    return envToken
  }

  // TODO: Check git config in Phase 3.
  // For now, require environment variable.
  throw new Error(
    'GitLab token not found. Set GITLAB_TOKEN environment variable.',
  )
}
