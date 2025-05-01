import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME, normalizeFixOptions } from './shared.mts'
import constants from '../../constants.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { FixOptions } from './types.mts'

const { NPM, PNPM } = constants

export async function runFix(options_: FixOptions) {
  const options = normalizeFixOptions(options_)
  const pkgEnvDetails = await detectAndValidatePackageEnvironment(options.cwd, {
    cmdName: CMD_NAME,
    logger
  })
  if (!pkgEnvDetails) {
    return
  }
  logger.info(`Fixing packages for ${pkgEnvDetails.agent}`)
  const { agent } = pkgEnvDetails
  if (agent === NPM) {
    await npmFix(pkgEnvDetails, options)
  } else if (agent === PNPM) {
    await pnpmFix(pkgEnvDetails, options)
  }
}
