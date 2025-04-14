import { logger } from '@socketsecurity/registry/lib/logger'

import { applyLogout } from './apply-logout'
import { isReadOnlyConfig } from '../../utils/config'

export function attemptLogout() {
  try {
    applyLogout()
    logger.success('Successfully logged out')
    if (isReadOnlyConfig()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!'
      )
    }
  } catch {
    logger.fail('Failed to complete logout steps')
  }
}
