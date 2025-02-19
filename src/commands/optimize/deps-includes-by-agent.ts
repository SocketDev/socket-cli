import constants from '../../constants.ts'

import type { Agent } from '../../utils/package-manager-detector.ts'

type AgentDepsIncludesFn = (stdout: string, name: string) => boolean

const { BUN, NPM, PNPM, VLT, YARN_BERRY, YARN_CLASSIC } = constants

function matchHumanStdout(stdout: string, name: string) {
  return stdout.includes(` ${name}@`)
}

function matchQueryStdout(stdout: string, name: string) {
  return stdout.includes(`"${name}"`)
}

export const depsIncludesByAgent: Record<Agent, AgentDepsIncludesFn> = {
  // @ts-ignore
  __proto__: null,

  [BUN]: matchHumanStdout,
  [NPM]: matchQueryStdout,
  [PNPM]: matchQueryStdout,
  [VLT]: matchQueryStdout,
  [YARN_BERRY]: matchHumanStdout,
  [YARN_CLASSIC]: matchHumanStdout
}
