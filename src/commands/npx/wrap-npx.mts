import { createRequire } from 'node:module'

import constants from '../../constants.mts'

const require = createRequire(import.meta.url)

const { NPX } = constants

export async function wrapNpx(argv: readonly string[]) {
  // Lazily access constants.distShadowNpmBinPath.
  const shadowBin = require(constants.distShadowNpmBinPath)
  await shadowBin(NPX, argv)
}
