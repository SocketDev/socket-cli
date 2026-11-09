import { logger } from '@socketsecurity/registry/lib/logger'

import { applyLogout } from './apply-logout.mts'
import constants from '../../constants.mts'
import { isConfigFromFlag } from '../../utils/config.mts'
import { getErrorCause } from '../../utils/errors.mts'
import { logoutOAuth } from '../../utils/oauth.mts'
import { getDefaultProxyUrl } from '../../utils/sdk.mts'

export async function attemptLogout() {
  let warning: string | undefined
  try {
    const directory = constants.socketAppDataPath
    if (directory && !isConfigFromFlag()) {
      const result = await logoutOAuth(directory, {
        apiProxy: getDefaultProxyUrl(),
      })
      warning = result.warning
    }
    applyLogout()
    logger.success('Successfully logged out')
    if (warning) {
      logger.warn(`Local sign-out completed. ${warning}`)
    }
    if (constants.ENV.SOCKET_CLI_API_TOKEN) {
      logger.warn(
        'SOCKET_CLI_API_TOKEN remains active and takes precedence until it is unset.',
      )
    }
    if (isConfigFromFlag()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the logout was not persisted!',
      )
    }
  } catch (error) {
    logger.fail('Failed to complete logout steps')
    logger.warn(getErrorCause(error))
  }
}
