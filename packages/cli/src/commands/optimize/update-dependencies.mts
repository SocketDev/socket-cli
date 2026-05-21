/* oxlint-disable-next-line socket/no-file-scope-oxlint-disable -- legitimate file-scope: domain-grouped layout or test fixture; per-call would produce many redundant disables. */
/* oxlint-disable socket/no-logger-newline-literal -- CLI output formatting: multi-line user-facing messages where embedded \n produces the intended layout. Splitting into logger.log("") + logger.log(...) pairs is the canonical rewrite but doesnt preserve the visual flow for these specific outputs. */
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/registry'

import { runAgentInstall } from './agent-installer.mts'
import { NPM_BUGGY_OVERRIDES_PATCHED_VERSION } from '../../constants/packages.mts'
import { cmdPrefixMessage } from '../../util/process/cmd.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../util/ecosystem/environment.mjs'
import type { Logger } from '@socketsecurity/lib-stable/logger'
import type { SpinnerInstance } from '@socketsecurity/lib-stable/spinner/types'

type UpdateDependenciesOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  spinner?: SpinnerInstance | undefined
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
      getDefaultSpinner().start()
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
    getDefaultSpinner().start()
  }

  return { ok: true, data: undefined }
}
