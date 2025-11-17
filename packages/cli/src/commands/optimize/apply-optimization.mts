import { getDefaultSpinner } from '@socketsecurity/lib/spinner'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { addOverrides } from './add-overrides.mts'
import { CMD_NAME } from './shared.mts'
import { updateDependencies } from './update-dependencies.mts'

import type { CResult } from '../../types.mts'
import type { EnvDetails } from '../../utils/ecosystem/environment.mjs'

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
  const logger = getDefaultLogger()
  const spinner = getDefaultSpinner()

  spinner?.start()

  const state = await addOverrides(pkgEnvDetails, pkgEnvDetails.pkgPath, {
    logger,
    pin,
    prod,
    spinner: spinner ?? undefined,
  })

  const addedCount = state.added.size
  const updatedCount = state.updated.size
  const pkgJsonChanged = addedCount > 0 || updatedCount > 0

  if (pkgJsonChanged || pkgEnvDetails.features.npmBuggyOverrides) {
    const result = await updateDependencies(pkgEnvDetails, {
      cmdName: CMD_NAME,
      logger,
      spinner: spinner ?? undefined,
    })

    if (!result.ok) {
      spinner?.stop()
      return result
    }
  }

  spinner?.stop()
  return {
    ok: true,
    data: {
      addedCount,
      addedInWorkspaces: state.addedInWorkspaces.size,
      pkgJsonChanged,
      updatedCount,
      updatedInWorkspaces: state.updatedInWorkspaces.size,
    },
  }
}
