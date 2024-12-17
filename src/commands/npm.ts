import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const npm: CliSubcommand = {
  description: 'npm wrapper functionality',
  async run(argv) {
    // Lazily access constants.distPath.
    const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
    await shadowBin('npm', argv)
  }
}
