import meow from 'meow'
import terminalLink from 'terminal-link'

import isInteractive from '@socketregistry/is-interactive/index.cjs'
import { confirm, password, select } from '@socketsecurity/registry/lib/prompts'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants'
import { AuthError, InputError } from '../utils/errors'
import { getFlagListOutput } from '../utils/output-formatting'
import { setupSdk } from '../utils/sdk'
import { getSetting, updateSetting } from '../utils/settings'

import type { CliSubcommand } from '../utils/meow-with-subcommands'
import type { Separator } from '@socketsecurity/registry/lib/prompts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

type Choice<Value> = {
  value: Value
  name?: string
  description?: string
  disabled?: boolean | string
  type?: never
}

type OrgChoice = Choice<string>

type OrgChoices = (Separator | OrgChoice)[]

const { SOCKET_PUBLIC_API_TOKEN } = constants

const description = 'Socket API login'

const flags: { [key: string]: any } = {
  apiBaseUrl: {
    type: 'string',
    description: 'API server to connect to for login'
  },
  apiProxy: {
    type: 'string',
    description: 'Proxy to use when making connection to API server'
  }
}

function nonNullish<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export const loginCommand: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} login`
    const cli = meow(
      `
      Usage
        $ ${name}

      Logs into the Socket API by prompting for an API key

      Options
        ${getFlagListOutput(
          {
            'api-base-url': flags['apiBaseUrl'].description,
            'api-proxy': flags['apiProxy'].description
          },
          8
        )}

      Examples
        $ ${name}
    `,
      {
        argv,
        description,
        importMeta,
        flags
      }
    )
    let showHelp = cli.flags['help']
    if (cli.input.length) {
      showHelp = true
    }
    if (showHelp) {
      cli.showHelp()
      return
    }
    if (!isInteractive()) {
      throw new InputError(
        'Cannot prompt for credentials in a non-interactive shell'
      )
    }
    const apiToken =
      (await password({
        message: `Enter your ${terminalLink(
          'Socket.dev API key',
          'https://docs.socket.dev/docs/api-keys'
        )} (leave blank for a public key)`
      })) || SOCKET_PUBLIC_API_TOKEN

    let apiBaseUrl = cli.flags['apiBaseUrl'] as string | null | undefined
    apiBaseUrl ??= getSetting('apiBaseUrl') ?? undefined

    let apiProxy = cli.flags['apiProxy'] as string | null | undefined
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
      .filter(nonNullish)
      .filter(org => org.plan === 'enterprise')
      .map(org => ({
        name: org.name,
        value: org.id
      }))

    let enforcedOrgs: string[] = []

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

    updateSetting('enforcedOrgs', enforcedOrgs)
    const oldToken = getSetting('apiToken')
    updateSetting('apiToken', apiToken)
    updateSetting('apiBaseUrl', apiBaseUrl)
    updateSetting('apiProxy', apiProxy)
    spinner.success(`API credentials ${oldToken ? 'updated' : 'set'}`)
  }
}
