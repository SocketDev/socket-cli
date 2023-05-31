import isInteractive from 'is-interactive'
import meow from 'meow'
import ora from 'ora'
import prompts from 'prompts'

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

    if (cli.input.length) cli.showHelp()

    if (!isInteractive()) {
      throw new InputError('cannot prompt for credentials in a non-interactive shell')
    }
    const { apiKey } = await prompts({
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Socket.dev API key',
    })

    if (!apiKey) {
      ora('API key not updated').warn()
      return
    }

    const spinner = ora('Verifying API key...').start()

    const oldKey = getSetting('apiKey')
    updateSetting('apiKey', apiKey)
    try {
      const sdk = await setupSdk()
      const quota = await sdk.getQuota()
      if (!quota.success) throw new AuthError()
      spinner.succeed(`API key ${oldKey ? 'updated' : 'set'}`)
    } catch (e) {
      updateSetting('apiKey', oldKey)
      spinner.fail('Invalid API key')
    }
  }
}
