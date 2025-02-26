import constants from '../../constants'

const { NPX, SHADOW_BIN } = constants

export async function wrapNpx(argv: readonly string[]) {
  // Lazily access constants.distPath.
  const shadowBin = require(`${constants.distPath}/${SHADOW_BIN}.js`)
  await shadowBin(NPX, argv)
}
