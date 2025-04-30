import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { addOverrides } from './add-overrides.mts'
import { CMD_NAME } from './shared.mts'
import { updateLockfile } from './update-lockfile.mts'
import constants from '../../constants.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

function createActionMessage(
  verb: string,
  overrideCount: number,
  workspaceCount: number
): string {
  return `${verb} ${overrideCount} Socket.dev optimized ${pluralize('override', overrideCount)}${workspaceCount ? ` in ${workspaceCount} ${pluralize('workspace', workspaceCount)}` : ''}`
}

export async function applyOptimization(
  cwd: string,
  pin: boolean,
  prod: boolean
) {
  const pkgEnvDetails = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
    prod
  })
  if (!pkgEnvDetails) {
    return
  }
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start('Socket optimizing...')

  const state = await addOverrides(pkgEnvDetails, pkgEnvDetails.pkgPath, {
    logger,
    pin,
    prod,
    spinner
  })

  const addedCount = state.added.size
  const updatedCount = state.updated.size
  const pkgJsonChanged = addedCount > 0 || updatedCount > 0

  if (pkgJsonChanged || pkgEnvDetails.features.npmBuggyOverrides) {
    await updateLockfile(pkgEnvDetails, { cmdName: CMD_NAME, logger, spinner })
  }

  spinner.stop()

  if (pkgJsonChanged) {
    if (updatedCount > 0) {
      logger?.log(
        `${createActionMessage('Updated', updatedCount, state.updatedInWorkspaces.size)}${addedCount ? '.' : '🚀'}`
      )
    }
    if (addedCount > 0) {
      logger?.log(
        `${createActionMessage('Added', addedCount, state.addedInWorkspaces.size)} 🚀`
      )
    }
  } else {
    logger?.log('Congratulations! Already Socket.dev optimized 🎉')
  }
}
