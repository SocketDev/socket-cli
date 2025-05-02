import terminalLink from 'terminal-link'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'

import { applyLogin } from './apply-login.mts'
import constants from '../../constants.mts'
import { handleApiCall } from '../../utils/api.mts'
import { getConfigValueOrUndef, isReadOnlyConfig } from '../../utils/config.mts'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { Choice, Separator } from '@socketsecurity/registry/lib/prompts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>
const { SOCKET_PUBLIC_API_TOKEN } = constants

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  apiBaseUrl ??= getConfigValueOrUndef('apiBaseUrl') ?? undefined
  apiProxy ??= getConfigValueOrUndef('apiProxy') ?? undefined
  const apiToken =
    (await password({
      message: `Enter your ${terminalLink(
        'Socket.dev API key',
        'https://docs.socket.dev/docs/api-keys'
      )} (leave blank for a public key)`
    })) || SOCKET_PUBLIC_API_TOKEN

  const sdk = await setupSdk(apiToken, apiBaseUrl, apiProxy)

  const result = await handleApiCall(
    sdk.getOrganizations(),
    'Verifying API key...',
    'Received response',
    'Error verifying API key',
    'getOrganizations'
  )

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  logger.success('API key verified')

  const orgs: SocketSdkReturnType<'getOrganizations'>['data'] = result.data

  const enforcedChoices: OrgChoices = Object.values(orgs.organizations)
    .filter(org => org?.plan === 'enterprise')
    .map(org => ({
      name: org.name ?? 'undefined',
      value: org.id
    }))

  let enforcedOrgs: string[] = []
  if (enforcedChoices.length > 1) {
    const id = (await select({
      message:
        "Which organization's policies should Socket enforce system-wide?",
      choices: enforcedChoices.concat({
        name: 'None',
        value: '',
        description: 'Pick "None" if this is a personal device'
      })
    })) as string | null
    if (id) {
      enforcedOrgs = [id]
    }
  } else if (enforcedChoices.length) {
    if (
      await confirm({
        message: `Should Socket enforce ${(enforcedChoices[0] as OrgChoice)?.name}'s security policies system-wide?`,
        default: true
      })
    ) {
      const existing = enforcedChoices[0] as OrgChoice
      if (existing) {
        enforcedOrgs = [existing.value]
      }
    }
  }

  const previousPersistedToken = getConfigValueOrUndef('apiToken')
  try {
    applyLogin(apiToken, enforcedOrgs, apiBaseUrl, apiProxy)
    logger.success(
      `API credentials ${previousPersistedToken === apiToken ? 'refreshed' : previousPersistedToken ? 'updated' : 'set'}`
    )
    if (isReadOnlyConfig()) {
      logger.log('')
      logger.warn(
        'Note: config is in read-only mode, at least one key was overridden through flag/env, so the login was not persisted!'
      )
    }
  } catch {
    logger.fail(`API login failed`)
  }
}
