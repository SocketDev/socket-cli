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
    const orgChoices = Object.values(settings.organizations)
      .map(org => ({
        title: org.name,
        description: `${org.plan.tier} tier`,
        selected: true,
        value: org.id
      }))

    /** @type {string[]} */
    let orgIDs = []

    if (orgChoices.length > 1) {
      const { ids } = await prompts({
        type: 'multiselect',
        name: 'ids',
        instructions: '',
        hint: '\n  Use ←/→/space to select and deselect, then hit enter to submit\n',
        message: 'Which organizations\' policies would you like Socket to enforce?',
        choices: orgChoices,
        min: 0,
        onState: promptAbortHandler
      })
      orgIDs = ids
    } else if (orgChoices.length) {
      const { confirmOrg } = await prompts({
        type: 'confirm',
        name: 'confirmOrg',
        message: `Enforce organization policies for ${orgChoices[0]?.title}?`,
        initial: true,
        onState: promptAbortHandler
      })
      if (confirmOrg) {
        orgIDs = [orgChoices[0]?.value]
      }
    }
    updateSetting('orgs', orgIDs.map(id => ({
      id,
      issueRules: settings.organizations[id].issueRules
    })))
    const oldKey = getSetting('apiKey')
    updateSetting('apiKey', apiKey)
    spinner.succeed(`API credentials ${oldKey ? 'updated' : 'set'}`)
  }
}
