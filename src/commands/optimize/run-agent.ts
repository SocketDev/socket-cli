import spawn from '@npmcli/promise-spawn'

import { isDebug } from '@socketsecurity/registry/lib/debug'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants'
import { safeNpmInstall } from '../../utils/npm'

import type { Agent } from '../../utils/package-environment-detector'

const { NPM, abortSignal } = constants

type SpawnOption = Exclude<Parameters<typeof spawn>[2], undefined>
type SpawnResult = ReturnType<typeof spawn>

export type AgentInstallOptions = SpawnOption & {
  args?: string[] | undefined
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
  const isSpinning = spinner?.isSpinning ?? false
  if (!isSilent) {
    spinner?.stop()
  }
  let spawnPromise = spawn(agentExecPath, ['install', ...args], {
    signal: abortSignal,
    stdio: isSilent ? 'ignore' : 'inherit',
    ...spawnOptions,
    env: {
      ...process.env,
      ...spawnOptions.env
    }
  })
  if (!isSilent && isSpinning) {
    const oldSpawnPromise = spawnPromise
    spawnPromise = <typeof oldSpawnPromise>spawnPromise.finally(() => {
      spinner?.start()
    })
    spawnPromise.process = oldSpawnPromise.process
    ;(spawnPromise as any).stdin = (spawnPromise as any).stdin
  }
  return spawnPromise
}
