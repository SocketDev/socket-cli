import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix'
import { pnpmFix } from './pnpm-fix'
import constants from '../../constants'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment'

import type { RangeStyle } from './types'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { NPM, PNPM } = constants

const CMD_NAME = 'socket fix'

type RunFixOptions = {
  cwd?: string | undefined
  rangeStyle?: RangeStyle | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export async function runFix({
  cwd = process.cwd(),
  rangeStyle,
  spinner,
  test = false,
  testScript = 'test'
}: RunFixOptions) {
  const pkgEnvDetails = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger
  })
  if (!pkgEnvDetails) {
    spinner?.stop()
    return
  }
  logger.info(`Fixing packages for ${pkgEnvDetails.agent}`)
  switch (pkgEnvDetails.agent) {
    case NPM: {
      await npmFix(pkgEnvDetails, {
        rangeStyle,
        spinner,
        test,
        testScript
      })
      break
    }
    case PNPM: {
      await pnpmFix(pkgEnvDetails, {
        rangeStyle,
        spinner,
        test,
        testScript
      })
      break
    }
  }
  // spinner.successAndStop('Socket.dev fix successful')
}
