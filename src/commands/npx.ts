import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { NPX } = constants

export const npxCommand: CliSubcommand = {
  description: `${NPX} wrapper functionality`,
  async run(argv) {
    // Lazily access constants.distPath.
    const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
    await shadowBin(NPX, argv)
  }
}
