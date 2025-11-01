import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { applyLogout } from './apply-logout.mts'
import { isConfigFromFlag } from '../../utils/config.mts'

export function attemptLogout() {
  try {
    applyLogout()
    getDefaultLogger().success('Successfully logged out')
    if (isConfigFromFlag()) {
      getDefaultLogger().log('')
      getDefaultLogger().warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
      )
    }
  } catch {
    getDefaultLogger().fail('Failed to complete logout steps')
  }
}
