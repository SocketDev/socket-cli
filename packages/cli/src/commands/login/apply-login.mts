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

export function applyLogin(params: {
  apiToken: string
  enforcedOrgs: string[]
  apiBaseUrl: string | undefined
  apiProxy: string | undefined
  authBaseUrl?: string | null | undefined
  oauthClientId?: string | null | undefined
  oauthRedirectUri?: string | null | undefined
  oauthRefreshToken?: string | null | undefined
  oauthScopes?: string[] | readonly string[] | null | undefined
  oauthTokenExpiresAt?: number | null | undefined
}) {
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, params.enforcedOrgs)
  updateConfigValue(CONFIG_KEY_API_TOKEN, params.apiToken)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, params.apiBaseUrl)
  updateConfigValue(CONFIG_KEY_API_PROXY, params.apiProxy)

  if (params.authBaseUrl !== undefined) {
    updateConfigValue(CONFIG_KEY_AUTH_BASE_URL, params.authBaseUrl)
  }
  if (params.oauthClientId !== undefined) {
    updateConfigValue(CONFIG_KEY_OAUTH_CLIENT_ID, params.oauthClientId)
  }
  if (params.oauthRedirectUri !== undefined) {
    updateConfigValue(CONFIG_KEY_OAUTH_REDIRECT_URI, params.oauthRedirectUri)
  }
  if (params.oauthRefreshToken !== undefined) {
    updateConfigValue(CONFIG_KEY_OAUTH_REFRESH_TOKEN, params.oauthRefreshToken)
  }
  if (params.oauthScopes !== undefined) {
    updateConfigValue(CONFIG_KEY_OAUTH_SCOPES, params.oauthScopes)
  }
  if (params.oauthTokenExpiresAt !== undefined) {
    updateConfigValue(
      CONFIG_KEY_OAUTH_TOKEN_EXPIRES_AT,
      params.oauthTokenExpiresAt,
    )
  }
}
