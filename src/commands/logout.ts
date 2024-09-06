import meow from 'meow'
import ora from 'ora'

import { updateSetting } from '../utils/settings'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const description = 'Socket API logout'

export const logout: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} logout`
    const cli = meow(
      `
      Usage
        $ ${name}

      Logs out of the Socket API and clears all Socket credentials from disk

      Examples
        $ ${name}
    `,
      {
        argv,
        description,
        importMeta
      }
    )

    if (cli.input.length) {
      cli.showHelp()
    }

    updateSetting('apiKey', null)
    updateSetting('apiBaseUrl', null)
    updateSetting('apiProxy', null)
    updateSetting('enforcedOrgs', null)
    ora('Successfully logged out').succeed()
  }
}
