import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'
import { cmdFlagsToString } from '../../utils/cmd'
import { safeNpmInstall } from '../../utils/npm'

import type { EnvDetails } from '../../utils/package-environment'

const { NPM } = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>
type SpawnResult = ReturnType<typeof spawn>

export type AgentInstallOptions = SpawnOption & {
  args?: string[] | readonly string[] | undefined
  spinner?: Spinner | undefined
}

export function runAgentInstall(
  pkgEnvDetails: EnvDetails,
  options?: AgentInstallOptions | undefined
): SpawnResult {
  const { agent, agentExecPath } = pkgEnvDetails
  // All package managers support the "install" command.
  if (agent === NPM) {
    return safeNpmInstall({
      agentExecPath,
      ...options
    })
  }
  const {
    args = [],
    spinner,
    ...spawnOptions
  } = { __proto__: null, ...options } as AgentInstallOptions
  return spawn(agentExecPath, ['install', ...args], {
    spinner,
    stdio: isDebug() ? 'inherit' : 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      NODE_OPTIONS: cmdFlagsToString([
        // Lazily access constants.nodeHardenFlags.
        // ...constants.nodeHardenFlags,
        // Lazily access constants.nodeNoWarningsFlags.
        ...constants.nodeNoWarningsFlags
      ]),
      ...spawnOptions.env
    }
  })
}
