import {
  BUN,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib/constants/agents'

import type { EnvDetails } from '../../utils/ecosystem/environment.mjs'

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
    default:
      return matchQueryCmdStdout(stdout, name)
  }
}
