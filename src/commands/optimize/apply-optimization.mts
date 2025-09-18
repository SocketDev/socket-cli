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
  const { spinner } = constants

  // Debug CI issues on Windows.
  if (process.env['CI']) {
    console.error(`[DEBUG] applyOptimization called:`)
    console.error(`  platform: ${process.platform}`)
    console.error(`  agent: ${pkgEnvDetails.agent}`)
    console.error(`  pkgPath: ${pkgEnvDetails.pkgPath}`)
    console.error(`  pin: ${pin}`)
    console.error(`  prod: ${prod}`)
  }

  spinner.start()

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

    // Debug CI issues on Windows.
    if (process.env['CI']) {
      console.error(`[DEBUG] updateLockfile returned:`)
      console.error(`  result.ok: ${result.ok}`)
      console.error(`  result.message: ${(result as any).message || 'none'}`)
    }

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
      addedInWorkspaces: state.addedInWorkspaces.size,
      pkgJsonChanged,
      updatedCount,
      updatedInWorkspaces: state.updatedInWorkspaces.size,
    },
  }
}
