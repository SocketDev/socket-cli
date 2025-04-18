import constants from '../../constants'

import type { Agent } from '../../utils/package-environment'

type AgentDepsIncludesFn = (stdout: string, name: string) => boolean

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function matchLsCmdViewHumanStdout(stdout: string, name: string) {
  return stdout.includes(` ${name}@`)
}

function matchQueryCmdStdout(stdout: string, name: string) {
  return stdout.includes(`"${name}"`)
}

export const depsIncludesByAgent = new Map<Agent, AgentDepsIncludesFn>([
  [BUN, matchLsCmdViewHumanStdout],
  [NPM, matchQueryCmdStdout],
  [PNPM, matchQueryCmdStdout],
  [VLT, matchQueryCmdStdout],
  [YARN_BERRY, matchLsCmdViewHumanStdout],
  [YARN_CLASSIC, matchLsCmdViewHumanStdout]
])
