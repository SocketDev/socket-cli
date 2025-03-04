import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { runAgentInstall } from './run-agent'
import constants from '../../constants'

import type { PackageEnvironmentDetails } from '../../utils/package-environment-detector'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { NPM } = constants

const COMMAND_TITLE = 'Socket Optimize'

export type UpdatePackageLockJsonOptions = {
  logger?: Logger | undefined
  spinner?: Spinner | undefined
}
export async function updatePackageLockJson(
  pkgEnvDetails: PackageEnvironmentDetails,
  options: UpdatePackageLockJsonOptions
) {
  const { logger, spinner } = <UpdatePackageLockJsonOptions>{
    __proto__: null,
    ...options
  }
  spinner?.start(`Updating ${pkgEnvDetails.lockName}...`)
  try {
    await runAgentInstall(pkgEnvDetails.agent, pkgEnvDetails.agentExecPath, {
      spinner
    })
    spinner?.stop()
    if (pkgEnvDetails.agent === NPM) {
      logger?.log(
        `💡 Re-run ${COMMAND_TITLE} whenever ${pkgEnvDetails.lockName} changes.\n   This can be skipped once npm v11.2.0 is released.`
      )
    }
  } catch (e) {
    spinner?.stop()
    logger?.fail(
      `${COMMAND_TITLE}: ${pkgEnvDetails.agent} install failed to update ${pkgEnvDetails.lockName}`
    )
    logger?.error(e)
  }
}
