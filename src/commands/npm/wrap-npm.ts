import constants from '../../constants'

const { NPM, SHADOW_BIN } = constants

export async function wrapNpm(argv: readonly string[]) {
  // Lazily access constants.distPath.
  const shadowBin = require(`${constants.distPath}/${SHADOW_BIN}.js`)
  await shadowBin(NPM, argv)
}
