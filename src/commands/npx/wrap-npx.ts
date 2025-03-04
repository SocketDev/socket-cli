import constants from '../../constants'

const { NPX } = constants

export async function wrapNpx(argv: readonly string[]) {
  // Lazily access constants.distShadowNpmBinPath.
  const shadowBin = require(constants.distShadowNpmBinPath)
  await shadowBin(NPX, argv)
}
