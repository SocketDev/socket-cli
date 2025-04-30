import constants from '../../constants.mts'

const { NPM } = constants

export async function wrapNpm(argv: readonly string[]) {
  // Lazily access constants.distShadowNpmBinPath.
  const shadowBin = require(constants.distShadowNpmBinPath)
  await shadowBin(NPM, argv)
}
