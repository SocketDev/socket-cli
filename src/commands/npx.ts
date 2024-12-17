import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const npx: CliSubcommand = {
  description: 'npx wrapper functionality',
  async run(argv) {
    // Lazily access constants.distPath.
    const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
    await shadowBin('npx', argv)
  }
}
