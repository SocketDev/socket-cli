/**
 * Provider interface for Pull Request / Merge Request operations.
 *
 * This abstraction allows Socket CLI to work with both GitHub (Pull Requests)
 * and GitLab (Merge Requests) using a unified interface.
 */

export interface PrProvider {
  // Core operations.
  createPr(options: CreatePrOptions): Promise<PrResponse>
  updatePr(options: UpdatePrOptions): Promise<void>
  listPrs(options: ListPrsOptions): Promise<PrMatch[]>
  deleteBranch(branch: string): Promise<boolean>
  addComment(prNumber: number, body: string): Promise<void>

  // Metadata.
  getProviderName(): 'github' | 'gitlab'
  supportsGraphQL(): boolean
}

export interface CreatePrOptions {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body: string
  retries?: number
}

export interface UpdatePrOptions {
  owner: string
  repo: string
  prNumber: number
  head: string
  base: string
}

export interface ListPrsOptions {
  owner: string
  repo: string
  author?: string
  states?: 'all' | 'open' | 'closed'
  ghsaId?: string
}

export interface PrResponse {
  number: number
  url: string
  state: 'open' | 'closed' | 'merged'
}

export interface PrMatch {
  number: number
  title: string
  author: string
  headRefName: string
  baseRefName: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  mergeStateStatus: MergeStateStatus
}

export type MergeStateStatus =
  | 'BEHIND'
  | 'BLOCKED'
  | 'CLEAN'
  | 'DIRTY'
  | 'DRAFT'
  | 'HAS_HOOKS'
  | 'UNKNOWN'
  | 'UNSTABLE'
