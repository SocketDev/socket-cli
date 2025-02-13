import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

const { NPM } = constants

export const npmCommand: CliSubcommand = {
  description: `${NPM} wrapper functionality`,
  async run(argv) {
    // Lazily access constants.distPath.
    const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
    await shadowBin(NPM, argv)
  }
}
