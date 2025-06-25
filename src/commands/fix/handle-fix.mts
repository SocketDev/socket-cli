import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { npmFix } from './npm-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { spawnCoana } from '../../utils/coana.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { FixOptions } from './agent-fix.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

const { NPM, PNPM } = constants

export type HandleFixOptions = Remap<
  FixOptions & {
    ghsas: string[]
    outputKind: OutputKind
  }
>

export async function handleFix(
  argv: string[] | readonly string[],
  {
    autoMerge,
    cwd,
    ghsas,
    limit,
    outputKind,
    purls,
    rangeStyle,
    test,
    testScript,
  }: HandleFixOptions,
) {
  let { length: ghsasCount } = ghsas
  if (ghsasCount) {
    // Lazily access constants.spinner.
    const { spinner } = constants

    spinner.start('Fetching GHSA IDs...')

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
        debugFn('coana fail:', {
          message: autoCResult.message,
          cause: autoCResult.cause,
        })
        ghsas = []
        ghsasCount = 0
      }
    }

    if (ghsasCount) {
      spinner.info(`Found ${ghsasCount} GHSA ${pluralize('ID', ghsasCount)}.`)

      await outputFixResult(
        await spawnCoana(
          [
            'compute-fixes-and-upgrade-purls',
            cwd,
            '--apply-fixes-to',
            ...ghsas,
            ...argv,
          ],
          { cwd, spinner },
        ),
        outputKind,
      )
      spinner.stop()
      return
    }

    spinner.infoAndStop('No GHSA IDs found.')

    await outputFixResult(
      {
        ok: true,
        data: '',
      },
      outputKind,
    )
    return
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
        message: 'No package found.',
        cause: `No valid package environment found for project path: ${cwd}`,
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
        message: 'Not supported.',
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
