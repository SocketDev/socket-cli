import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_AUTH_BASE_URL,
  CONFIG_KEY_ENFORCED_ORGS,
  CONFIG_KEY_OAUTH_CLIENT_ID,
  CONFIG_KEY_OAUTH_REDIRECT_URI,
  CONFIG_KEY_OAUTH_REFRESH_TOKEN,
  CONFIG_KEY_OAUTH_SCOPES,
  CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT,
} from '../../constants/config.mts'
import { updateConfigValue } from '../../utils/config.mts'

export function applyLogout() {
  updateConfigValue(CONFIG_KEY_API_TOKEN, null)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_API_PROXY, null)
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, null)
  updateConfigValue(CONFIG_KEY_AUTH_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_OAUTH_CLIENT_ID, null)
  updateConfigValue(CONFIG_KEY_OAUTH_REDIRECT_URI, null)
  updateConfigValue(CONFIG_KEY_OAUTH_REFRESH_TOKEN, null)
  updateConfigValue(CONFIG_KEY_OAUTH_SCOPES, null)
  updateConfigValue(CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT, null)
}
