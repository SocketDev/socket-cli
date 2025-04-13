import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix'
import { pnpmFix } from './pnpm-fix'
import { CMD_NAME, assignDefaultFixOptions } from './shared'
import constants from '../../constants'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment'

import type { FixOptions } from './types'

const { NPM, PNPM } = constants

export async function runFix(options_: FixOptions) {
  const options = assignDefaultFixOptions({
    __proto__: null,
    ...options_
  } as FixOptions)
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
