import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from '../../constants/config.mts'
import { updateConfigValue } from '../../utils/config.mts'

export function applyLogout() {
  updateConfigValue(CONFIG_KEY_API_TOKEN, null)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_API_PROXY, null)
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, null)
}
