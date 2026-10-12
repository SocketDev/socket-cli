import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_ENFORCED_ORGS,
} from '../../constants/config.mts'
import { updateConfigValue } from '../../util/config.mts'
import {
  clearOAuthSession,
  saveOAuthSession,
} from '../../util/socket/oauth-session.mts'
import { invalidateDefaultApiToken } from '../../util/socket/sdk.mts'

import type {
  SocketOAuthCredentialOptions,
  SocketOAuthTokenSet,
} from '@socketsecurity/lib-stable/secrets/socket-oauth'

export async function applyLogin(
  apiToken: string,
  enforcedOrgs: string[],
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
  oauth?:
    | {
        options: SocketOAuthCredentialOptions
        tokens: SocketOAuthTokenSet
      }
    | undefined,
): Promise<void> {
  if (oauth) {
    await saveOAuthSession(oauth.options, oauth.tokens)
  } else {
    await clearOAuthSession()
  }
  updateConfigValue(CONFIG_KEY_ENFORCED_ORGS, enforcedOrgs)
  updateConfigValue(CONFIG_KEY_API_TOKEN, oauth ? undefined : apiToken)
  updateConfigValue(CONFIG_KEY_API_BASE_URL, apiBaseUrl)
  updateConfigValue(CONFIG_KEY_API_PROXY, apiProxy)
  invalidateDefaultApiToken()
}
