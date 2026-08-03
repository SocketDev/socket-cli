export type Direction = 'asc' | 'desc'

/**
 * Sort keys accepted by the Socket API's `listRepositories` operation
 * (`ListRepositoriesOptions['sort']` in the SDK's strict types).
 */
export type RepositorySort = 'created_at' | 'name' | 'updated_at'
