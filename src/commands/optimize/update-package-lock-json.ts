import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { runAgentInstall } from './run-agent'
import constants from '../../constants'

import type { PackageEnvironmentDetails } from '../../utils/package-environment-detector'

const { NPM } = constants

const COMMAND_TITLE = 'Socket Optimize'
const NPM_OVERRIDE_PR_URL = 'https://github.com/npm/cli/pull/8089'

export type UpdatePackageLockJsonOptions = {
  logger?: Console | undefined
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
        `💡 Re-run ${COMMAND_TITLE} whenever ${pkgEnvDetails.lockName} changes.\n   This can be skipped once npm ships ${NPM_OVERRIDE_PR_URL}.`
      )
    }
  } catch (e: any) {
    spinner?.error(
      `${COMMAND_TITLE}: ${pkgEnvDetails.agent} install failed to update ${pkgEnvDetails.lockName}`
    )
    logger?.error(e)
  }
}
