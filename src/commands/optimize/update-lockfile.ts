import semver from 'semver'

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { runAgentInstall } from './run-agent'
import constants from '../../constants'
import { cmdPrefixMessage } from '../../utils/cmd'

import type { EnvDetails } from '../../utils/package-environment'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { NPM, NPM_BUGGY_OVERRIDES_PATCHED_VERSION } = constants

export type UpdateLockfileOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  spinner?: Spinner | undefined
}
export async function updateLockfile(
  pkgEnvDetails: EnvDetails,
  options: UpdateLockfileOptions
) {
  const {
    cmdName = '',
    logger,
    spinner
  } = {
    __proto__: null,
    ...options
  } as UpdateLockfileOptions
  spinner?.start(`Updating ${pkgEnvDetails.lockName}...`)
  try {
    await runAgentInstall(pkgEnvDetails, { spinner })
    spinner?.stop()
    if (pkgEnvDetails.features.npmBuggyOverrides) {
      logger?.log(
        `💡 Re-run ${cmdName ? `${cmdName} ` : ''}whenever ${pkgEnvDetails.lockName} changes.\n   This can be skipped for ${pkgEnvDetails.agent} >=${NPM_BUGGY_OVERRIDES_PATCHED_VERSION}.`
      )
    }
  } catch (e) {
    spinner?.stop()
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `${pkgEnvDetails.agent} install failed to update ${pkgEnvDetails.lockName}`
      )
    )
    logger?.error(e)
  }
}
