import type {
  CreatePrOptions,
  ListPrsOptions,
  PrMatch,
  PrProvider,
  PrResponse,
  UpdatePrOptions,
} from './provider.mts'

/**
 * GitHub provider for Pull Request operations.
 *
 * Implements the PrProvider interface using GitHub's REST and GraphQL APIs via Octokit.
 * TODO: Refactor existing GitHub PR logic into this provider in Phase 2.
 */
export class GitHubProvider implements PrProvider {
  async createPr(options: CreatePrOptions): Promise<PrResponse> {
    // TODO: Move openSocketFixPr() logic here in Phase 2.
    throw new Error('GitHub PR creation not yet refactored into provider')
  }

  async updatePr(options: UpdatePrOptions): Promise<void> {
    // TODO: Move update logic here in Phase 2.
    throw new Error('GitHub PR update not yet refactored into provider')
  }

  async listPrs(options: ListPrsOptions): Promise<PrMatch[]> {
    // TODO: Move getSocketFixPrsWithContext() logic here in Phase 2.
    throw new Error('GitHub PR listing not yet refactored into provider')
  }

  async deleteBranch(branch: string): Promise<boolean> {
    // TODO: Move branch deletion logic here in Phase 2.
    throw new Error('GitHub branch deletion not yet refactored into provider')
  }

  async addComment(prNumber: number, body: string): Promise<void> {
    // TODO: Move comment logic here in Phase 2.
    throw new Error('GitHub PR comments not yet refactored into provider')
  }

  getProviderName(): 'github' {
    return 'github'
  }

  supportsGraphQL(): boolean {
    // GitHub supports GraphQL and we use it for efficient PR listing.
    return true
  }
}
