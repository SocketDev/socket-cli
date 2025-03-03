import { isDebug } from '@socketsecurity/registry/lib/debug'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'
import { safeNpmInstall } from '../../utils/npm'

import type { Agent } from '../../utils/package-environment-detector'

const { NPM, abortSignal } = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>
type SpawnResult = ReturnType<typeof spawn>

export type AgentInstallOptions = SpawnOption & {
  args?: string[] | readonly string[] | undefined
  spinner?: Spinner | undefined
}

export function runAgentInstall(
  agent: Agent,
  agentExecPath: string,
  options: AgentInstallOptions
): SpawnResult {
  // All package managers support the "install" command.
  if (agent === NPM) {
    return safeNpmInstall(options)
  }
  const {
    args = [],
    spinner,
    ...spawnOptions
  } = <AgentInstallOptions>{ __proto__: null, ...options }
  const isSilent = !isDebug()
  return spawn(agentExecPath, ['install', ...args], {
    signal: abortSignal,
    spinner,
    stdio: isSilent ? 'ignore' : 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      ...spawnOptions.env
    }
  })
}
