import semver from 'semver'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { runAgentInstall } from './run-agent'
import constants from '../../constants'

import type { EnvDetails } from '../../utils/package-environment-detector'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { NPM } = constants

const COMMAND_TITLE = 'Socket Optimize'

export type UpdateLockfileOptions = {
  logger?: Logger | undefined
  spinner?: Spinner | undefined
}
export async function updateLockfile(
  pkgEnvDetails: EnvDetails,
  options: UpdateLockfileOptions
) {
  const { logger, spinner } = {
    __proto__: null,
    ...options
  } as UpdateLockfileOptions
  spinner?.start(`Updating ${pkgEnvDetails.lockName}...`)
  try {
    await runAgentInstall(pkgEnvDetails, { spinner })
    spinner?.stop()
    if (
      pkgEnvDetails.agent === NPM &&
      semver.lt(pkgEnvDetails.agentVersion, '11.2.0')
    ) {
      logger?.log(
        `💡 Re-run ${COMMAND_TITLE} whenever ${pkgEnvDetails.lockName} changes.\n   This can be skipped for npm >=11.2.0.`
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
