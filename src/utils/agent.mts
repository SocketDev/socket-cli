import { getOwn } from '@socketsecurity/registry/lib/objects'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../constants.mts'
import { cmdFlagsToString } from './cmd.mts'
import { shadowNpmInstall } from '../shadow/npm/install.mts'

import type { EnvDetails } from './package-environment.mts'

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
  const isNpm = agent === 'npm'
  const isPnpm = agent === 'pnpm'
  // All package managers support the "install" command.
  if (isNpm) {
    return shadowNpmInstall({
      agentExecPath,
      ...options,
    })
  }
  const {
    args = [],
    spinner,
    ...spawnOptions
  } = { __proto__: null, ...options } as AgentInstallOptions
  const skipNodeHardenFlags = isPnpm && pkgEnvDetails.agentVersion.major < 11
  return spawn(agentExecPath, ['install', ...args], {
    shell: constants.WIN32,
    spinner,
    stdio: 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      ...constants.processEnv,
      NODE_OPTIONS: cmdFlagsToString([
        ...(skipNodeHardenFlags ? [] : constants.nodeHardenFlags),
        ...constants.nodeNoWarningsFlags,
      ]),
      ...getOwn(spawnOptions, 'env'),
    },
  })
}
