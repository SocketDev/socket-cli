import terminalLink from 'terminal-link'

import {
  type Separator,
  confirm,
  password,
  select
} from '@socketsecurity/registry/lib/prompts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { applyLogin } from './apply-login.ts'
import constants from '../../constants.ts'
import { AuthError } from '../../utils/errors.ts'
import { setupSdk } from '../../utils/sdk.ts'
import { getSetting } from '../../utils/settings.ts'

import type { SocketSdkReturnType } from '@socketsecurity/sdk'

// TODO: this type should come from a general Socket REST API type doc
type Choice<Value> = {
  value: Value
  name?: string
  description?: string
  disabled?: boolean | string
  type?: never
}
type OrgChoice = Choice<string>
type OrgChoices = Array<Separator | OrgChoice>
const { SOCKET_PUBLIC_API_TOKEN } = constants

export async function attemptLogin(
  apiBaseUrl: string | undefined,
  apiProxy: string | undefined
) {
  const apiToken =
    (await password({
      message: `Enter your ${terminalLink(
        'Socket.dev API key',
        'https://docs.socket.dev/docs/api-keys'
      )} (leave blank for a public key)`
    })) || SOCKET_PUBLIC_API_TOKEN

  apiBaseUrl ??= getSetting('apiBaseUrl') ?? undefined
  apiProxy ??= getSetting('apiProxy') ?? undefined

  const spinner = new Spinner({ text: 'Verifying API key...' }).start()

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
    spinner.error('Invalid API key')
    return
  }

  const enforcedChoices: OrgChoices = Object.values(orgs.organizations)
    .filter(org => org?.plan === 'enterprise')
    .map(org => ({
      name: org.name,
      value: org.id
    }))

  let enforcedOrgs: Array<string> = []

  if (enforcedChoices.length > 1) {
    const id = <string | null>await select({
      message:
        "Which organization's policies should Socket enforce system-wide?",
      choices: enforcedChoices.concat({
        name: 'None',
        value: '',
        description: 'Pick "None" if this is a personal device'
      })
    })
    if (id) {
      enforcedOrgs = [id]
    }
  } else if (enforcedChoices.length) {
    const confirmOrg = await confirm({
      message: `Should Socket enforce ${(enforcedChoices[0] as OrgChoice)?.name}'s security policies system-wide?`,
      default: true
    })
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
    spinner.success(`API credentials ${oldToken ? 'updated' : 'set'}`)
  } catch {
    spinner.error(`API login failed`)
  }
}
