import meow from 'meow'
import ora from 'ora'

import { updateSetting } from '../../utils/settings.js'

const description = 'Socket API logout'

/** @type {import('../../utils/meow-with-subcommands').CliSubcommand} */
export const logout = {
  description,
  run: async (argv, importMeta, { parentName }) => {
    const name = parentName + ' logout'
    const cli = meow(`
      Usage
        $ ${name}

      Logs out of the Socket API and clears all Socket credentials from disk

      Examples
        $ ${name}
    `, {
      argv,
      description,
      importMeta,
    })

    if (cli.input.length) cli.showHelp()

    updateSetting('apiKey', null)
    updateSetting('enforcedOrg', null)
    ora('Successfully logged out').succeed()
  }
}
