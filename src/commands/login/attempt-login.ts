import terminalLink from 'terminal-link'

import { logger } from '@socketsecurity/registry/lib/logger'
import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'

import { applyLogin } from './apply-login'
import constants from '../../constants'
import { handleUnsuccessfulApiResponse } from '../../utils/api'
import { getConfigValue, isReadOnlyConfig } from '../../utils/config'
import { setupSdk } from '../../utils/sdk'

import type { Choice, Separator } from '@socketsecurity/registry/lib/prompts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>
const { SOCKET_PUBLIC_API_TOKEN } = constants

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  apiBaseUrl ??= getConfigValue('apiBaseUrl').data ?? undefined
  apiProxy ??= getConfigValue('apiProxy').data ?? undefined
  const apiToken =
    (await password({
      message: `Enter your ${terminalLink(
        'Socket.dev API key',
        'https://docs.socket.dev/docs/api-keys'
      )} (leave blank for a public key)`
    })) || SOCKET_PUBLIC_API_TOKEN
  // Lazily access constants.spinner.
  const { spinner } = constants

  const sdk = await setupSdk(apiToken, apiBaseUrl, apiProxy)

  spinner.start('Verifying API key...')

  const result = await sdk.getOrganizations()

  spinner.successAndStop('Received response')

  if (!result.success) {
    logger.fail('Authentication failed...')
    handleUnsuccessfulApiResponse('getOrganizations', result)
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

  spinner.stop()

  const previousPersistedToken = getConfigValue('apiToken').data
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
