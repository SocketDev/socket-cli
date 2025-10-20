import { logger } from '@socketsecurity/lib/logger'

import { applyLogout } from './apply-logout.mts'
import { isConfigFromFlag } from '../../utils/config.mts'

export function attemptLogout() {
  try {
    applyLogout()
    logger.success('Successfully logged out')
    if (isConfigFromFlag()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
      )
    }
  } catch {
    logger.fail('Failed to complete logout steps')
  }
}
