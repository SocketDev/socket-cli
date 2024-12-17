import constants from '../constants'

import type { CliSubcommand } from '../utils/meow-with-subcommands'

export const npx: CliSubcommand = {
  description: 'npx wrapper functionality',
  async run(argv) {
    // Lazily access constants.DIST_TYPE.
    const shadowBin = require(`../dist/${constants.DIST_TYPE}/shadow-bin.js`)
    await shadowBin('npx', argv)
  }
}
