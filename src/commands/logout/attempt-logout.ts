import { logger } from '@socketsecurity/registry/lib/logger'

import { applyLogout } from './apply-logout'

export function attemptLogout() {
  try {
    applyLogout()
    logger.success('Successfully logged out')
  } catch {
    logger.fail('Failed to complete logout steps')
  }
}
