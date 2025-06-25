import { logger } from '@socketsecurity/registry/lib/logger'

import { npmFix } from './npm-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { OutputKind } from '../../types.mts'
import type { RangeStyle } from '../../utils/semver.mts'

const { NPM, PNPM } = constants

export async function handleFix({
  autoMerge,
  cwd,
  ghsas,
  limit,
  outputKind,
  purls,
  rangeStyle,
  test,
  testScript,
}: {
  autoMerge: boolean
  cwd: string
  ghsas: string[]
  limit: number
  outputKind: OutputKind
  purls: string[]
  rangeStyle: RangeStyle
  test: boolean
  testScript: string
}) {
  let { length: ghsasCount } = ghsas
  if (ghsasCount) {
    // Lazily access constants.spinner.
    const { spinner } = constants

    spinner.start()

    if (ghsasCount === 1 && ghsas[0] === 'auto') {
      const autoCResult = await spawnCoana(
        ['compute-fixes-and-upgrade-purls', cwd],
        { cwd, spinner },
      )
      if (autoCResult.ok) {
        ghsas = cmdFlagValueToArray(
          /(?<=Vulnerabilities found: )[^\n]+/.exec(
            autoCResult.data as string,
          )?.[0],
        )
        ghsasCount = ghsas.length
      } else {
        ghsas = []
        ghsasCount = 0
      }
    }

    spinner.stop()

    if (ghsasCount) {
      spinner.start()
      await outputFixResult(
        await spawnCoana(
          [
            'compute-fixes-and-upgrade-purls',
            cwd,
            '--apply-fixes-to',
            ...ghsas,
          ],
          { cwd, spinner },
        ),
        outputKind,
      )
      spinner.stop()
      return
    }
  }

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
  })
  if (!pkgEnvCResult.ok) {
    await outputFixResult(pkgEnvCResult, outputKind)
    return
  }

  const { data: pkgEnvDetails } = pkgEnvCResult
  if (!pkgEnvDetails) {
    await outputFixResult(
      {
        ok: false,
        message: 'No package found',
        cause: `No valid package environment was found in given cwd (${cwd})`,
      },
      outputKind,
    )
    return
  }

  logger.info(
    `Fixing packages for ${pkgEnvDetails.agent} v${pkgEnvDetails.agentVersion}.\n`,
  )

  const { agent } = pkgEnvDetails
  if (agent !== NPM && agent !== PNPM) {
    await outputFixResult(
      {
        ok: false,
        message: 'Not supported',
        cause: `${agent} is not supported by this command at the moment.`,
      },
      outputKind,
    )
    return
  }

  // Lazily access spinner.
  const { spinner } = constants
  const fixer = agent === NPM ? npmFix : pnpmFix

  await outputFixResult(
    await fixer(pkgEnvDetails, {
      autoMerge,
      cwd,
      limit,
      purls,
      rangeStyle,
      spinner,
      test,
      testScript,
    }),
    outputKind,
  )
}
