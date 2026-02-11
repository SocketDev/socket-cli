import { joinAnd } from '@socketsecurity/lib/arrays'
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { confirm, password, select } from '@socketsecurity/lib/stdio/prompts'
import { isNonEmptyString } from '@socketsecurity/lib/strings'

import { applyLogin } from './apply-login.mts'
import { oauthLogin } from './oauth-login.mts'
import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_AUTH_BASE_URL,
  CONFIG_KEY_DEFAULT_ORG,
  CONFIG_KEY_OAUTH_CLIENT_ID,
  CONFIG_KEY_OAUTH_REDIRECT_URI,
  CONFIG_KEY_OAUTH_SCOPES,
} from '../../constants/config.mts'
import ENV from '../../constants/env.mts'
import {
  getConfigValueOrUndef,
  isConfigFromFlag,
  updateConfigValue,
} from '../../utils/config.mts'
import { deriveAuthBaseUrlFromApiBaseUrl } from '../../utils/auth/oauth.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { getEnterpriseOrgs, getOrgSlugs } from '../../utils/organization.mts'
import { setupSdk } from '../../utils/socket/sdk.mjs'
import { socketDocsLink } from '../../utils/terminal/link.mts'
import { setupTabCompletion } from '../install/setup-tab-completion.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { Choice } from '@socketsecurity/lib/stdio/prompts'
import requirements from '../../../data/command-api-requirements.json' with {
  type: 'json',
}
const logger = getDefaultLogger()

type OrgChoice = Choice<string>
type OrgChoices = OrgChoice[]

type LoginMethod = 'oauth' | 'token'

function getDefaultOAuthScopes(): string[] {
  const permissions: string[] = []
  const api = (requirements as any)?.api ?? {}
  for (const value of Object.values(api) as any[]) {
    const perms = (value?.permissions ?? []) as unknown
    if (Array.isArray(perms)) {
      for (const p of perms) {
        if (typeof p === 'string' && p) {
          permissions.push(p)
        }
      }
    }
  }
  return [...new Set(permissions)].sort()
}

function parseScopes(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort()
  }
  if (!isNonEmptyString(String(value ?? ''))) {
    return undefined
  }
  const raw = String(value)
  return raw
    .split(/[,\s]+/u)
    .map(s => s.trim())
    .filter(Boolean)
}

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
  options?: {
    method?: LoginMethod | undefined
    authBaseUrl?: string | undefined
    oauthClientId?: string | undefined
    oauthRedirectUri?: string | undefined
    oauthScopes?: string | undefined
  },
) {
  apiBaseUrl ??= getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL) ?? undefined
  apiProxy ??= getConfigValueOrUndef(CONFIG_KEY_API_PROXY) ?? undefined
  const method: LoginMethod = options?.method ?? 'oauth'

  let apiToken: string
  let oauthRefreshToken: string | null | undefined
  let oauthTokenExpiresAt: number | null | undefined
  let authBaseUrl: string | null | undefined
  let oauthClientId: string | null | undefined
  let oauthRedirectUri: string | null | undefined
  let oauthScopes: string[] | null | undefined

  if (method === 'token') {
    const apiTokenInput = await password({
      message: `Enter your ${socketDocsLink('/docs/api-keys', 'Socket.dev API token')} (leave blank to use a limited public token)`,
    })

    if (apiTokenInput === undefined) {
      logger.fail('Canceled by user')
      return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
    }

    apiToken = apiTokenInput || SOCKET_PUBLIC_API_TOKEN

    // Explicitly disable OAuth refresh flow when using a legacy org-wide token.
    oauthRefreshToken = null
    oauthTokenExpiresAt = null
    authBaseUrl = null
    oauthClientId = null
    oauthRedirectUri = null
    oauthScopes = null
  } else {
    const resolvedAuthBaseUrl =
      options?.authBaseUrl ||
      ENV.SOCKET_CLI_AUTH_BASE_URL ||
      getConfigValueOrUndef(CONFIG_KEY_AUTH_BASE_URL) ||
      deriveAuthBaseUrlFromApiBaseUrl(apiBaseUrl)

    if (!isNonEmptyString(resolvedAuthBaseUrl)) {
      process.exitCode = 1
      logger.fail(
        'OAuth auth base URL is not configured. Provide --auth-base-url or set SOCKET_CLI_AUTH_BASE_URL.',
      )
      return
    }

    const resolvedClientId =
      options?.oauthClientId ||
      ENV.SOCKET_CLI_OAUTH_CLIENT_ID ||
      getConfigValueOrUndef(CONFIG_KEY_OAUTH_CLIENT_ID) ||
      'socket-cli'

    const resolvedRedirectUri =
      options?.oauthRedirectUri ||
      ENV.SOCKET_CLI_OAUTH_REDIRECT_URI ||
      getConfigValueOrUndef(CONFIG_KEY_OAUTH_REDIRECT_URI) ||
      'http://127.0.0.1:53682/callback'

    const resolvedScopes =
      parseScopes(
        options?.oauthScopes ||
          ENV.SOCKET_CLI_OAUTH_SCOPES ||
          getConfigValueOrUndef(CONFIG_KEY_OAUTH_SCOPES) ||
          getDefaultOAuthScopes(),
      ) ?? []

    logger.log(
      `Opening your browser to complete login (client_id: ${resolvedClientId})...`,
    )

    const oauthResult = await oauthLogin({
      authBaseUrl: resolvedAuthBaseUrl,
      clientId: resolvedClientId,
      redirectUri: resolvedRedirectUri,
      scopes: resolvedScopes,
      apiProxy,
    })
    if (!oauthResult.ok) {
      process.exitCode = 1
      logger.fail(failMsgWithBadge(oauthResult.message, oauthResult.cause))
      return
    }

    apiToken = oauthResult.data.accessToken
    oauthRefreshToken = oauthResult.data.refreshToken
    oauthTokenExpiresAt = oauthResult.data.expiresAt
    authBaseUrl = resolvedAuthBaseUrl
    oauthClientId = resolvedClientId
    oauthRedirectUri = resolvedRedirectUri
    oauthScopes = resolvedScopes
  }

  const sockSdkCResult = await setupSdk({ apiBaseUrl, apiProxy, apiToken })
  if (!sockSdkCResult.ok) {
    process.exitCode = 1
    logger.fail(failMsgWithBadge(sockSdkCResult.message, sockSdkCResult.cause))
    return
  }

  const sockSdk = sockSdkCResult.data

  const orgsCResult = await fetchOrganization({
    description: 'token verification',
    sdk: sockSdk,
  })
  if (!orgsCResult.ok) {
    process.exitCode = 1
    logger.fail(failMsgWithBadge(orgsCResult.message, orgsCResult.cause))
    return
  }

  const { organizations } = orgsCResult.data

  const orgSlugs = getOrgSlugs(organizations)

  logger.success(`API token verified: ${joinAnd(orgSlugs)}`)

  const enterpriseOrgs = getEnterpriseOrgs(organizations)

  const enforcedChoices: OrgChoices = enterpriseOrgs.map(org => ({
    name: org['name'] ?? 'undefined',
    value: org['id'],
  }))

  let enforcedOrgs: string[] = []
  if (enforcedChoices.length > 1) {
    const id = await select({
      message:
        "Which organization's policies should Socket enforce system-wide?",
      choices: [
        ...enforcedChoices,
        {
          name: 'None',
          value: '',
          description: 'Pick "None" if this is a personal device',
        },
      ],
    })
    if (id === undefined) {
      logger.fail('Canceled by user')
      return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
    }
    if (id) {
      enforcedOrgs = [id]
    }
  } else if (enforcedChoices.length) {
    const shouldEnforce = await confirm({
      message: `Should Socket enforce ${(enforcedChoices[0] as OrgChoice)?.name}'s security policies system-wide?`,
      default: true,
    })
    if (shouldEnforce === undefined) {
      logger.fail('Canceled by user')
      return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
    }
    if (shouldEnforce) {
      const existing = enforcedChoices[0] as OrgChoice
      if (existing) {
        enforcedOrgs = [existing.value]
      }
    }
  }

  const wantToComplete = await select({
    message: 'Would you like to install bash tab completion?',
    choices: [
      {
        name: 'Yes',
        value: true,
        description:
          'Sets up tab completion for "socket" in your bash env. If you\'re unsure, this is probably what you want.',
      },
      {
        name: 'No',
        value: false,
        description:
          'Will skip tab completion setup. Does not change how Socket works.',
      },
    ],
  })
  if (wantToComplete === undefined) {
    logger.fail('Canceled by user')
    return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
  }
  if (wantToComplete) {
    logger.log('')
    logger.log('Setting up tab completion...')
    const setupCResult = await setupTabCompletion('socket')
    if (setupCResult.ok) {
      logger.success(
        'Tab completion will be enabled after restarting your terminal',
      )
    } else {
      logger.fail(
        'Failed to install tab completion script. Try `socket install completion` later.',
      )
    }
  }

  updateConfigValue(CONFIG_KEY_DEFAULT_ORG, orgSlugs[0])

  const previousPersistedToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  try {
    applyLogin({
      apiToken,
      enforcedOrgs,
      apiBaseUrl,
      apiProxy,
      authBaseUrl,
      oauthClientId,
      oauthRedirectUri,
      oauthRefreshToken,
      oauthScopes,
      oauthTokenExpiresAt,
    })
    logger.success(
      `API credentials ${previousPersistedToken === apiToken ? 'refreshed' : previousPersistedToken ? 'updated' : 'set'}`,
    )
    if (isConfigFromFlag()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the login was not persisted!',
      )
    }
  } catch {
    process.exitCode = 1
    logger.fail('API login failed')
  }
}
