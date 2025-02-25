import constants from '../../constants.ts'

const { NPM, SHADOW_BIN } = constants

export async function wrapNpm(argv: readonly string[]) {
  // Lazily access constants.distPath.
  const shadowBin = require(`${constants.distPath}/${SHADOW_BIN}.js`)
  await shadowBin(NPM, argv)
}
