import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'

import { applyLogin } from './apply-login.mts'
import constants, {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_AUTH_TYPE,
  CONFIG_KEY_DEFAULT_ORG,
} from '../../constants.mts'
import {
  getConfigValueOrUndef,
  isConfigFromFlag,
  updateConfigValue,
} from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import {
  OAUTH_ISSUER,
  beginOAuthLogin,
  logoutOAuth,
  saveOAuthCredentials,
} from '../../utils/oauth.mts'
import { getEnterpriseOrgs, getOrgSlugs } from '../../utils/organization.mts'
import {
  getDefaultApiBaseUrl,
  getDefaultProxyUrl,
  setupSdk,
} from '../../utils/sdk.mts'
import { socketDocsLink } from '../../utils/terminal-link.mts'
import { setupTabCompletion } from '../install/setup-tab-completion.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { Choice, Separator } from '@socketsecurity/registry/lib/prompts'

type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
  apiTokenMode = false,
) {
  if (!apiTokenMode) {
    return await attemptOAuthLogin(apiBaseUrl, apiProxy)
  }

  return await attemptApiTokenLogin(apiBaseUrl, apiProxy)
}

async function attemptApiTokenLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
) {
  apiBaseUrl ??= getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL) ?? undefined
  apiProxy ||= getDefaultProxyUrl()
  const apiTokenInput = await password({
    message: `Enter your ${socketDocsLink('/docs/api-keys', 'Socket.dev API token')} (leave blank to use a limited public token)`,
  })

  if (apiTokenInput === undefined) {
    logger.fail('Canceled by user')
    return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
  }

  const apiToken = apiTokenInput || constants.SOCKET_PUBLIC_API_TOKEN

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
    applyLogin(apiToken, enforcedOrgs, apiBaseUrl, apiProxy)
    if (constants.socketAppDataPath && !isConfigFromFlag()) {
      try {
        const result = await logoutOAuth(constants.socketAppDataPath, {
          apiProxy,
        })
        if (result.warning) {
          logger.warn(result.warning)
        }
      } catch {
        logger.warn('The previous browser sign-in could not be removed.')
      }
    }
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

async function attemptOAuthLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
) {
  if (isConfigFromFlag()) {
    throw new Error(
      'Browser sign-in cannot be saved while --config or SOCKET_CLI_CONFIG is active. Remove the config override and run `socket login` again.',
    )
  }
  const configuredBaseUrl = apiBaseUrl || getDefaultApiBaseUrl()
  if (configuredBaseUrl) {
    let configuredOrigin: string
    try {
      configuredOrigin = new URL(configuredBaseUrl).origin
    } catch {
      throw new Error('The configured Socket API URL is invalid for OAuth.')
    }
    if (configuredOrigin !== OAUTH_ISSUER) {
      throw new Error(
        'Browser sign-in is only available with Socket’s trusted API URL. Use `socket login --api-token --api-base-url <url>` for a custom API URL.',
      )
    }
  }

  const existingToken = getConfigValueOrUndef(CONFIG_KEY_API_TOKEN)
  const activeAuthType = getConfigValueOrUndef(CONFIG_KEY_AUTH_TYPE)
  if (existingToken && activeAuthType !== 'oauth') {
    const choice = await select({
      message:
        'An API token is already saved. Keep using it or switch to read-only browser sign-in?',
      choices: [
        { name: 'Keep the saved API token', value: 'keep' },
        {
          name: 'Switch to browser sign-in (read-only)',
          value: 'oauth',
        },
      ],
    })
    if (choice === undefined) {
      logger.fail('Canceled by user')
      return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
    }
    if (choice === 'keep') {
      logger.success('Kept the saved API token login')
      return { ok: true }
    }
  }

  apiProxy ||= getDefaultProxyUrl()
  const result = await beginOAuthLogin({
    apiProxy,
    openBrowser: true,
    onAuthorizationUrl(url) {
      logger.log('Open this URL in your browser to sign in:')
      logger.log(url)
    },
  })
  const baseUrl = new URL('/v0/', result.apiOrigin).href
  const sdkResult = await setupSdk({
    apiBaseUrl: baseUrl,
    apiProxy,
    apiToken: result.accessToken,
  })
  if (!sdkResult.ok) {
    process.exitCode = 1
    logger.fail(failMsgWithBadge(sdkResult.message, sdkResult.cause))
    return
  }
  const orgsResult = await fetchOrganization({
    description: 'browser sign-in validation',
    sdk: sdkResult.data,
  })
  if (!orgsResult.ok) {
    process.exitCode = 1
    logger.fail(failMsgWithBadge(orgsResult.message, orgsResult.cause))
    return
  }
  const orgSlugs = getOrgSlugs(orgsResult.data.organizations)
  if (orgSlugs.length === 0) {
    process.exitCode = 1
    logger.fail(
      'Browser sign-in succeeded, but no accessible organization was returned. Check your organization membership and try again; existing credentials were kept.',
    )
    return
  }

  await saveOAuthCredentials(constants.socketAppDataPath!, result)
  updateConfigValue(CONFIG_KEY_API_TOKEN, null)
  updateConfigValue(CONFIG_KEY_DEFAULT_ORG, orgSlugs[0])
  updateConfigValue(CONFIG_KEY_API_BASE_URL, null)
  updateConfigValue(CONFIG_KEY_API_PROXY, apiProxy)
  updateConfigValue(CONFIG_KEY_AUTH_TYPE, 'oauth')
  logger.success(`Browser sign-in saved for ${joinAnd(orgSlugs)}`)
  logger.warn(
    'This sign-in is read-only and supports package, alert, and threat-feed queries. Write and scan commands require API-token credentials; use `socket login --api-token` or SOCKET_CLI_API_TOKEN.',
  )
  if (constants.ENV.SOCKET_CLI_API_TOKEN) {
    logger.warn(
      'SOCKET_CLI_API_TOKEN remains active and takes precedence over browser sign-in for this session.',
    )
  }
}
