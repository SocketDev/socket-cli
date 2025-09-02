import terminalLink from 'terminal-link'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'

import { applyLogin } from './apply-login.mts'
import constants from '../../constants.mts'
import {
  getConfigValueOrUndef,
  isReadOnlyConfig,
  updateConfigValue,
} from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { getEnterpriseOrgs, getOrgSlugs } from '../../utils/organization.mts'
import { setupSdk } from '../../utils/sdk.mts'
import { setupTabCompletion } from '../install/setup-tab-completion.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { Choice, Separator } from '@socketsecurity/registry/lib/prompts'

type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined,
) {
  apiBaseUrl ??= getConfigValueOrUndef('apiBaseUrl') ?? undefined
  apiProxy ??= getConfigValueOrUndef('apiProxy') ?? undefined
  const apiTokenInput = await password({
    message: `Enter your ${terminalLink(
      'Socket.dev API token',
      'https://docs.socket.dev/docs/api-keys',
    )} (leave blank to use a limited public token)`,
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
    desc: 'token verification',
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
    name: org.name ?? 'undefined',
    value: org.id,
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

  updateConfigValue('defaultOrg', orgSlugs[0])

  const previousPersistedToken = getConfigValueOrUndef('apiToken')
  try {
    applyLogin(apiToken, enforcedOrgs, apiBaseUrl, apiProxy)
    logger.success(
      `API credentials ${previousPersistedToken === apiToken ? 'refreshed' : previousPersistedToken ? 'updated' : 'set'}`,
    )
    if (isReadOnlyConfig()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the login was not persisted!',
      )
    }
  } catch {
    process.exitCode = 1
    logger.fail(`API login failed`)
  }
}
