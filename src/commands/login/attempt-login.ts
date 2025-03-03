import terminalLink from 'terminal-link'

import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'

import { applyLogin } from './apply-login'
import constants from '../../constants'
import { AuthError } from '../../utils/errors'
import { setupSdk } from '../../utils/sdk'
import { getSetting } from '../../utils/settings'

import type { Choice, Separator } from '@socketsecurity/registry/lib/prompts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>
const { SOCKET_PUBLIC_API_TOKEN } = constants

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  apiBaseUrl ??= getSetting('apiBaseUrl') ?? undefined
  apiProxy ??= getSetting('apiProxy') ?? undefined
  const apiToken =
    (await password({
      message: `Enter your ${terminalLink(
        'Socket.dev API key',
        'https://docs.socket.dev/docs/api-keys'
      )} (leave blank for a public key)`
    })) || SOCKET_PUBLIC_API_TOKEN
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Verifying API key...')

  let orgs: SocketSdkReturnType<'getOrganizations'>['data']
  try {
    const sdk = await setupSdk(apiToken, apiBaseUrl, apiProxy)
    const result = await sdk.getOrganizations()
    if (!result.success) {
      throw new AuthError()
    }
    orgs = result.data
    spinner.success('API key verified')
  } catch {
    spinner.errorAndStop('Invalid API key')
    return
  }

  const enforcedChoices: OrgChoices = Object.values(orgs.organizations)
    .filter(org => org?.plan === 'enterprise')
    .map(org => ({
      name: org.name,
      value: org.id
    }))

  let enforcedOrgs: string[] = []
  if (enforcedChoices.length > 1) {
    const id = <string | null>await select(
      {
        message:
          "Which organization's policies should Socket enforce system-wide?",
        choices: enforcedChoices.concat({
          name: 'None',
          value: '',
          description: 'Pick "None" if this is a personal device'
        })
      },
      {
        spinner
      }
    )
    if (id) {
      enforcedOrgs = [id]
    }
  } else if (enforcedChoices.length) {
    const confirmOrg = await confirm(
      {
        message: `Should Socket enforce ${(enforcedChoices[0] as OrgChoice)?.name}'s security policies system-wide?`,
        default: true
      },
      {
        spinner
      }
    )
    if (confirmOrg) {
      const existing = <OrgChoice>enforcedChoices[0]
      if (existing) {
        enforcedOrgs = [existing.value]
      }
    }
  }

  const oldToken = getSetting('apiToken')
  try {
    applyLogin(apiToken, enforcedOrgs, apiBaseUrl, apiProxy)
    spinner.successAndStop(`API credentials ${oldToken ? 'updated' : 'set'}`)
  } catch {
    spinner.errorAndStop(`API login failed`)
  }
}
