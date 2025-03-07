import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix'
import { pnpmFix } from './pnpm-fix'
import constants from '../../constants'
import { detectAndValidatePackageEnvironment } from '../optimize/detect-and-validate-package-environment'

const { NPM, PNPM } = constants

export async function runFix() {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start()

  const cwd = process.cwd()

  const pkgEnvDetails = await detectAndValidatePackageEnvironment(cwd, {
    logger
  })
  if (!pkgEnvDetails) {
    spinner.stop()
    return
  }

  switch (pkgEnvDetails.agent) {
    case NPM: {
      await npmFix(pkgEnvDetails, cwd)
      break
    }
    case PNPM: {
      await pnpmFix(pkgEnvDetails, cwd)
      break
    }
  }
  spinner.successAndStop('Socket.dev fix successful')
}
