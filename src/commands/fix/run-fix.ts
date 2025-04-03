import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix'
import { pnpmFix } from './pnpm-fix'
import constants from '../../constants'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment'

const { NPM, PNPM } = constants

const CMD_NAME = 'socket fix'

export async function runFix({ cwd = process.cwd(), testScript = 'test' }) {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start()

  const pkgEnvDetails = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger
  })
  if (!pkgEnvDetails) {
    spinner.stop()
    return
  }

  switch (pkgEnvDetails.agent) {
    case NPM: {
      await npmFix(pkgEnvDetails, {
        testScript
      })
      break
    }
    case PNPM: {
      await pnpmFix(pkgEnvDetails, {
        testScript
      })
      break
    }
  }
  spinner.successAndStop('Socket.dev fix successful')
}
