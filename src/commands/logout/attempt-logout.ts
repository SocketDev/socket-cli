import { applyLogout } from './apply-logout'
import { logger } from '../../utils/logging'

export function attemptLogout() {
  try {
    applyLogout()
    logger.success('Successfully logged out')
  } catch {
    logger.error('Failed to complete logout steps')
  }
}
