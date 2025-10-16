import { debug, debugDir } from '@socketsecurity/registry/lib/debug'

import { runAgentInstall } from './agent-installer.mts'
import { NPM_BUGGY_OVERRIDES_PATCHED_VERSION } from '../../constants/packages.mts'
import { cmdPrefixMessage } from '../../utils/process/cmd.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/ecosystem/environment.mjs'
import type { Logger } from '@socketsecurity/registry/lib/logger'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

export type UpdateDependenciesOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  spinner?: Spinner | undefined
}

export async function updateDependencies(
  pkgEnvDetails: EnvDetails,
  options: UpdateDependenciesOptions,
): Promise<CResult<unknown>> {
  const {
    cmdName = '',
    logger,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as UpdateDependenciesOptions

  const wasSpinning = !!spinner?.isSpinning

  spinner?.start(`Updating ${pkgEnvDetails.lockName}...`)

  try {
    await runAgentInstall(pkgEnvDetails, { spinner })

    if (pkgEnvDetails.features.npmBuggyOverrides) {
      spinner?.stop()
      logger?.log(
        `💡 Re-run ${cmdName ? `${cmdName} ` : ''}whenever ${pkgEnvDetails.lockName} changes.\n   This can be skipped for ${pkgEnvDetails.agent} >=${NPM_BUGGY_OVERRIDES_PATCHED_VERSION}.`,
      )
    }
  } catch (e) {
    spinner?.stop()

    debug('Dependencies update failed')
    debugDir(e)

    if (wasSpinning) {
      spinner.start()
    }

    return {
      ok: false,
      message: 'Dependencies update failed',
      cause: cmdPrefixMessage(
        cmdName,
        `${pkgEnvDetails.agent} install failed to update ${pkgEnvDetails.lockName}. ` +
          `Check that ${pkgEnvDetails.agent} is properly installed and your project configuration is valid. ` +
          `Run '${pkgEnvDetails.agent} install' manually to see detailed error information.`,
      ),
    }
  }

  spinner?.stop()

  if (wasSpinning) {
    spinner.start()
  }

  return { ok: true, data: undefined }
}
