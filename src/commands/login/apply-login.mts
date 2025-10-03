/** @fileoverview Login credential persistence for Socket CLI. Writes API token, enforced organizations, base URL, and proxy settings to Socket configuration file. Handles configuration updates for successful login. */

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from '../../constants.mts'
import { updateConfigValue } from '../../utils/config.mts'

export function applyLogin(
  apiToken: string,
  enforcedOrgs: string[],
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
) {
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, enforcedOrgs)
  updateConfigValue(CONFIG_KEY_API_TOKEN, apiToken)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, apiBaseUrl)
  updateConfigValue(CONFIG_KEY_API_PROXY, apiProxy)
}
