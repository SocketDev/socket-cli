import isInteractive from 'is-interactive'
import meow from 'meow'
import ora from 'ora'
import prompts from 'prompts'
import terminalLink from 'terminal-link'

import { AuthError, InputError } from '../../utils/errors.js'
import { setupSdk } from '../../utils/sdk.js'
import { getSetting, updateSetting } from '../../utils/settings.js'

const description = 'Socket API login'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const login = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    const name = parentName + ' login'
    const cli = meow(`
      Usage
        $ ${name}

      Logs into the Socket API by prompting for an API key

      Examples
        $ ${name}
    `, {
      argv,
      description,
      importMeta,
    })

    /**
     * @param {{aborted: boolean}} state
     */
    const promptAbortHandler = (state) => {
      if (state.aborted) {
        process.nextTick(() => process.exit(1))
      }
    }

    if (cli.input.length) cli.showHelp()

    if (!isInteractive()) {
      throw new InputError('cannot prompt for credentials in a non-interactive shell')
    }
    const { apiKey } = await prompts({
      type: 'password',
      name: 'apiKey',
      message: `Enter your ${terminalLink(
        'Socket.dev API key',
        'https://docs.socket.dev/docs/api-keys'
      )}`,
      onState: promptAbortHandler
    })

    const spinner = ora('Verifying API key...').start()

    /** @type {import('@socketsecurity/sdk').SocketSdkReturnType<'getSettings'>['data']} */
    let settings

    try {
      const sdk = await setupSdk(apiKey)
      const result = await sdk.getSettings()
      if (!result.success) throw new AuthError()
      settings = result.data
      spinner.succeed('API key verified\n')
    } catch (e) {
      spinner.fail('Invalid API key')
      return
    }

    /** @type {prompts.Choice[]} */
    const enforcedChoices = Object.values(settings.organizations)
      .filter(org => org.plan.tier === 'enterprise')
      .map(org => ({
        title: org.name,
        value: org.id
      }))

    /** @type {string | null} */
    let enforcedOrg = null

    if (enforcedChoices.length > 1) {
      const { id } = await prompts({
        type: 'select',
        name: 'id',
        hint: '\n  Pick "None" if this is a personal device',
        message: 'Which organization\'s policies should Socket globally enforce?',
        choices: enforcedChoices.concat({
          title: 'None',
          value: null
        }),
        onState: promptAbortHandler
      })
      enforcedOrg = id
    } else if (enforcedChoices.length) {
      const { confirmOrg } = await prompts({
        type: 'confirm',
        name: 'confirmOrg',
        message: `Should Socket globally enforce ${enforcedChoices[0]?.title}'s security policies?`,
        initial: true,
        onState: promptAbortHandler
      })
      if (confirmOrg) {
        enforcedOrg = enforcedChoices[0]?.value
      }
    }
    updateSetting('enforcedOrg', enforcedOrg)
    const oldKey = getSetting('apiKey')
    updateSetting('apiKey', apiKey)
    spinner.succeed(`API credentials ${oldKey ? 'updated' : 'set'}`)
  }
}
