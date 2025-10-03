/** @fileoverview Dependency installation orchestrator for Socket CLI. Triggers package manager install to update lockfiles after override modifications. Handles npm buggy overrides detection and error reporting. */

import { Spinner } from '@socketsecurity/registry/lib/spinner'

import { runAgentInstall } from './agent-installer.mts'
import constants from '../../constants.mts'
import { cmdPrefixMessage } from '../../utils/cmd.mts'
import { debugDir, debugFn } from '../../utils/debug.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { Logger } from '@socketsecurity/registry/lib/logger'

const { NPM_BUGGY_OVERRIDES_PATCHED_VERSION } = constants

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

    debugFn('error', 'Dependencies update failed')
    debugDir('error', e)

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
