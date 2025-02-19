import constants from '../../constants.ts'

const { NPM } = constants

export async function wrapNpm(argv: readonly string[]) {
  // Lazily access constants.distPath.
  const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
  await shadowBin(NPM, argv)
}
