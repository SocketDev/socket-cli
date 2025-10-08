/**
 * @fileoverview Handler for deleting repositories.
 */

import { logger } from '@socketsecurity/registry/lib/logger'

import type { OutputKind } from '../../types.mts'

/**
 * Handle repository deletion.
 */
export async function handleDeleteRepo(
  nameOrId: string,
  options: {
    force?: boolean
    outputKind: OutputKind
  },
): Promise<void> {
  // TODO: Implement actual repository deletion
  if (!options.force) {
    logger.warn(`Would delete repository: ${nameOrId}`)
    logger.log('Use --force to actually delete')
  } else {
    logger.log(`Deleting repository: ${nameOrId}`)
  }
}