/** @fileoverview Logout credential cleanup for Socket CLI. Clears API token, enforced organizations, base URL, and proxy settings from Socket configuration file. Handles configuration cleanup for successful logout. */

import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from '../../constants.mts'
import { updateConfigValue } from '../../utils/config.mts'

export function applyLogout() {
  updateConfigValue(CONFIG_KEY_API_TOKEN, null)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_API_PROXY, null)
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, null)
}
