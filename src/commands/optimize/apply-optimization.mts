import { logger } from '@socketsecurity/registry/lib/logger'

import { addOverrides } from './add-overrides.mts'
import { CMD_NAME } from './shared.mts'
import { updateLockfile } from './update-lockfile.mts'
import constants from '../../constants.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'

export type OptimizeConfig = {
  pin: boolean
  prod: boolean
}

export async function applyOptimization(
  pkgEnvDetails: EnvDetails,
  { pin, prod }: OptimizeConfig,
): Promise<
  CResult<{
    addedCount: number
    updatedCount: number
    pkgJsonChanged: boolean
    updatedInWorkspaces: number
    addedInWorkspaces: number
  }>
> {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Socket optimizing...')

  const state = await addOverrides(pkgEnvDetails, pkgEnvDetails.pkgPath, {
    logger,
    pin,
    prod,
    spinner,
  })

  const addedCount = state.added.size
  const updatedCount = state.updated.size
  const pkgJsonChanged = addedCount > 0 || updatedCount > 0

  if (pkgJsonChanged || pkgEnvDetails.features.npmBuggyOverrides) {
    const result = await updateLockfile(pkgEnvDetails, {
      cmdName: CMD_NAME,
      logger,
      spinner,
    })
    if (!result.ok) {
      spinner.stop()
      return result
    }
  }

  spinner.stop()
  return {
    ok: true,
    data: {
      addedCount,
      updatedCount,
      pkgJsonChanged,
      updatedInWorkspaces: state.updatedInWorkspaces.size,
      addedInWorkspaces: state.addedInWorkspaces.size,
    },
  }
}
