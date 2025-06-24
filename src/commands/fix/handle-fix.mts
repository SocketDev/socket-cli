import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { OutputKind } from '../../types.mts'
import type { RangeStyle } from '../../utils/semver.mts'

const { NPM, PNPM } = constants

export async function handleFix({
  autoMerge,
  cwd,
  limit,
  outputKind,
  purls,
  rangeStyle,
  test,
  testScript,
}: {
  autoMerge: boolean
  cwd: string
  limit: number
  outputKind: OutputKind
  purls: string[]
  rangeStyle: RangeStyle
  test: boolean
  testScript: string
}) {
  const pkgEnvResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
  })
  if (!pkgEnvResult.ok) {
    return pkgEnvResult
  }

  const pkgEnvDetails = pkgEnvResult.data
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
  if (agent !== NPM && agent !== PNPM) {
    return {
      ok: false,
      message: 'Not supported',
      cause: `${agent} is not supported by this command at the moment.`,
    }
  }

  // Lazily access spinner.
  const { spinner } = constants
  const fixer = agent === NPM ? npmFix : pnpmFix

  const result = await fixer(pkgEnvDetails, {
    autoMerge,
    cwd,
    limit,
    purls,
    rangeStyle,
    spinner,
    test,
    testScript,
  })

  await outputFixResult(result, outputKind)
}
