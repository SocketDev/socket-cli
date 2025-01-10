import meow from 'meow'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

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
    let showHelp = cli.flags['help']
    if (cli.input.length) {
      showHelp = true
    }
    if (showHelp) {
      cli.showHelp()
      return
    }
    updateSetting('apiKey', null)
    updateSetting('apiBaseUrl', null)
    updateSetting('apiProxy', null)
    updateSetting('enforcedOrgs', null)
    new Spinner().success('Successfully logged out')
  }
}
