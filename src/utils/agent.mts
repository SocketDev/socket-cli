import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants.mts'
import { cmdFlagsToString } from './cmd.mts'
import { safeNpmInstall } from '../shadow/npm/install.mts'

import type { EnvDetails } from './package-environment.mts'

const { NPM, PNPM } = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>

export type AgentInstallOptions = SpawnOption & {
  args?: string[] | readonly string[] | undefined
  spinner?: Spinner | undefined
}

export type AgentSpawnResult = ReturnType<typeof spawn>

export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options?: AgentInstallOptions | undefined,
): AgentSpawnResult {
  const { agent, agentExecPath } = pkgEnvDetails
  // All package managers support the "install" command.
  if (agent === NPM) {
    return safeNpmInstall({
      agentExecPath,
      ...options,
    })
  }
  const {
    args = [],
    spinner,
    ...spawnOptions
  } = { __proto__: null, ...options } as AgentInstallOptions
  const skipNodeHardenFlags =
    agent === PNPM && pkgEnvDetails.agentVersion.major < 11
  return spawn(agentExecPath, ['install', ...args], {
    // Lazily access constants.WIN32.
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      // Lazily access constants.processEnv.
      ...constants.processEnv,
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags
          ? []
          : // Lazily access constants.nodeHardenFlags.
            constants.nodeHardenFlags),
        // Lazily access constants.nodeNoWarningsFlags.
        ...constants.nodeNoWarningsFlags,
      ]),
      ...spawnOptions.env,
    },
  })
}
