import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { Spinner } from '@socketsecurity/registry/lib/spinner'

import constants from '../../constants.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import { cmdPrefixMessage } from '../../utils/cmd.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { NPM_BUGGY_OVERRIDES_PATCHED_VERSION } = constants

export type UpdateLockfileOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  spinner?: Spinner | undefined
}

export async function updateLockfile(
  pkgEnvDetails: EnvDetails,
  options: UpdateLockfileOptions,
): Promise<CResult<unknown>> {
  const {
    cmdName = '',
    logger,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as UpdateLockfileOptions

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

    debugFn('error', 'fail: update')
    debugDir('inspect', { error: e })

    if (wasSpinning) {
      spinner.start()
    }

    return {
      ok: false,
      message: 'Update failed',
      cause: cmdPrefixMessage(
        cmdName,
        `${pkgEnvDetails.agent} install failed to update ${pkgEnvDetails.lockName}`,
      ),
    }
  }

  spinner?.stop()

  if (wasSpinning) {
    spinner.start()
  }

  return { ok: true, data: undefined }
}
