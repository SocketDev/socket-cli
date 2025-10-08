/**
 * @fileoverview Handler for listing repositories.
 */

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types.mts'

/**
 * Handle repository listing.
 */
export async function handleListRepos(options: {
  limit?: number
  page?: number
  sort?: string
  outputKind: OutputKind
}): Promise<void> {
  // TODO: Implement actual repository listing
  logger.log('Listing repositories...')
  logger.log(`Limit: ${options.limit ?? 10}`)
  logger.log(`Page: ${options.page ?? 1}`)
  if (options.sort) {
    logger.log(`Sort: ${options.sort}`)
  }
}