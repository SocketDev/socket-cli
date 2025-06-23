import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { CResult } from '../../types.mts'
import type { RangeStyle } from '../../utils/semver.mts'

const { NPM, PNPM } = constants

export async function runFix({
  autoMerge,
  cwd,
  limit,
  purls,
  rangeStyle,
  test,
  testScript,
}: {
  autoMerge: boolean
  cwd: string
  limit: number
  purls: string[]
  rangeStyle: RangeStyle
  test: boolean
  testScript: string
}): Promise<CResult<unknown>> {
  const result = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
  })

  if (!result.ok) {
    return result
  }
  const pkgEnvDetails = result.data
  if (!pkgEnvDetails) {
    return {
      ok: false,
      message: 'No package found',
      cause: `No valid package environment was found in given cwd (${cwd})`,
    }
  }

  logger.info(
    `Fixing packages for ${pkgEnvDetails.agent} v${pkgEnvDetails.agentVersion}.\n`,
  )

  const { agent } = pkgEnvDetails

  if (agent === NPM) {
    return await npmFix(pkgEnvDetails, {
      autoMerge,
      cwd,
      limit,
      purls,
      rangeStyle,
      test,
      testScript,
    })
  } else if (agent === PNPM) {
    return await pnpmFix(pkgEnvDetails, {
      autoMerge,
      cwd,
      limit,
      purls,
      rangeStyle,
      test,
      testScript,
    })
  } else {
    return {
      ok: false,
      message: 'Not supported',
      cause: `${agent} is not supported by this command at the moment.`,
    }
  }
}
