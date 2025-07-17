import constants from '../../constants.mts'

import type { EnvDetails } from '../../utils/package-environment.mts'

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

export function matchLsCmdViewHumanStdout(stdout: string, name: string) {
  return stdout.includes(` ${name}@`)
}

export function matchQueryCmdStdout(stdout: string, name: string) {
  return stdout.includes(`"${name}"`)
}

export function lsStdoutIncludes(
  pkgEnvDetails: EnvDetails,
  stdout: string,
  name: string,
): boolean {
  switch (pkgEnvDetails.agent) {
    case BUN:
    case YARN_BERRY:
    case YARN_CLASSIC:
      return matchLsCmdViewHumanStdout(stdout, name)
    case PNPM:
    case VLT:
    case NPM:
    default:
      return matchQueryCmdStdout(stdout, name)
  }
}
