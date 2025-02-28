import constants from '../../constants'

import type { Agent } from '../../utils/package-environment-detector'

type AgentDepsIncludesFn = (stdout: string, name: string) => boolean

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function matchHumanStdout(stdout: string, name: string) {
  return stdout.includes(` ${name}@`)
}

function matchQueryStdout(stdout: string, name: string) {
  return stdout.includes(`"${name}"`)
}

export const depsIncludesByAgent = new Map<Agent, AgentDepsIncludesFn>([
  [BUN, matchHumanStdout],
  [NPM, matchQueryStdout],
  [PNPM, matchQueryStdout],
  [VLT, matchQueryStdout],
  [YARN_BERRY, matchHumanStdout],
  [YARN_CLASSIC, matchHumanStdout]
])
