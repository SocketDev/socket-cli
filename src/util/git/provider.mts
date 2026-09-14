/**
 * Provider interface for Pull Request / Merge Request operations.
 *
 * This abstraction allows Socket CLI to work with both GitHub, Pull Requests
 * and GitLab, Merge Requests, using a unified interface.
 */

export interface PrProvider {
  // Core operations.
  createPr(config: CreatePrConfig): Promise<PrResponse>
  updatePr(config: UpdatePrConfig): Promise<void>
  listPrs(config: ListPrsConfig): Promise<PrMatch[]>
  deleteBranch(branch: string): Promise<boolean>
  addComment(config: AddCommentConfig): Promise<void>

  // Metadata.
  getProviderName(): 'github' | 'gitlab'
  supportsGraphQL(): boolean
}

export interface CreatePrConfig {
  owner: string
  repo: string
  title: string
  head: string
  base: string
  body: string
  retries?: number | undefined
}

export interface UpdatePrConfig {
  owner: string
  repo: string
  prNumber: number
  head: string
  base: string
}

export interface AddCommentConfig {
  owner: string
  repo: string
  prNumber: number
  body: string
}

export interface ListPrsConfig {
  owner: string
  repo: string
  author?: string | undefined
  states?: 'all' | 'open' | 'closed' | undefined
  ghsaId?: string | undefined
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
