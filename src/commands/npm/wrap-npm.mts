import { createRequire } from 'node:module'

import constants from '../../constants.mts'

const require = createRequire(import.meta.url)

const { NPM } = constants

export async function wrapNpm(argv: readonly string[]) {
  // Lazily access constants.distShadowNpmBinPath.
  const shadowBin = require(constants.distShadowNpmBinPath)
  await shadowBin(NPM, argv)
}
