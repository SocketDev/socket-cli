import constants from '../../constants.ts'

const { NPX } = constants

export async function wrapNpx(argv: readonly string[]) {
  // Lazily access constants.distPath.
  const shadowBin = require(`${constants.distPath}/shadow-bin.js`)
  await shadowBin(NPX, argv)
}
