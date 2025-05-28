import { logger } from '@socketsecurity/registry/lib/logger'

import { addOverrides } from './add-overrides.mts'
import { CMD_NAME } from './shared.mts'
import { updateLockfile } from './update-lockfile.mts'
import constants from '../../constants.mts'
import { cmdPrefixMessage } from '../../utils/cmd.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { CResult } from '../../types.mts'

const { VLT } = constants

export async function applyOptimization(
  cwd: string,
  pin: boolean,
  prod: boolean,
): Promise<
  CResult<{
    addedCount: number
    updatedCount: number
    pkgJsonChanged: boolean
    updatedInWorkspaces: number
    addedInWorkspaces: number
  }>
> {
  const result = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
    prod,
  })

  if (!result.ok) {
    return result
  }
  const pkgEnvDetails = result.data

  if (pkgEnvDetails.agent === VLT) {
    return {
      ok: false,
      message: 'Unsupported',
      cause: cmdPrefixMessage(
        CMD_NAME,
        `${VLT} does not support overrides. Soon, though ⚡`,
      ),
    }
  }

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
    await updateLockfile(pkgEnvDetails, { cmdName: CMD_NAME, logger, spinner })
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
