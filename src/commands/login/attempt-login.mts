import { joinAnd } from '@socketsecurity/lib/arrays'
import { SOCKET_PUBLIC_API_TOKEN } from '@socketsecurity/lib/constants/socket'
import { logger } from '@socketsecurity/lib/logger'
import { confirm, password, select } from '@socketsecurity/lib/prompts'

import { applyLogin } from './apply-login.mts'
import {
  CONFIG_KEY_API_BASE_URL,
  CONFIG_KEY_API_PROXY,
  CONFIG_KEY_API_TOKEN,
  CONFIG_KEY_DEFAULT_ORG,
} from '../../constants/config.mts'
import {
  getConfigValueOrUndef,
  isConfigFromFlag,
  updateConfigValue,
} from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { getEnterpriseOrgs, getOrgSlugs } from '../../utils/organization.mts'
import { setupSdk } from '../../utils/socket/sdk.mjs'
import { socketDocsLink } from '../../utils/terminal/link.mts'
import { setupTabCompletion } from '../install/setup-tab-completion.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { Choice } from '@socketsecurity/lib/prompts'

type OrgChoice = Choice<string>
type OrgChoices = OrgChoice[]

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
) {
  apiBaseUrl ??= getConfigValueOrUndef(CONFIG_KEY_API_BASE_URL) ?? undefined
  apiProxy ??= getConfigValueOrUndef(CONFIG_KEY_API_PROXY) ?? undefined
  const apiTokenInput = await password({
    message: `Enter your ${socketDocsLink('/docs/api-keys', 'Socket.dev API token')} (leave blank to use a limited public token)`,
  })

  if (apiTokenInput === undefined) {
    logger.fail('Canceled by user')
    return { ok: false, message: 'Canceled', cause: 'Canceled by user' }
  }

  const apiToken = apiTokenInput || SOCKET_PUBLIC_API_TOKEN

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
