import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
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

import type { FixConfig } from './agent-fix.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export type HandleFixConfig = Remap<
  FixConfig & {
    ghsas: string[]
    orgSlug: string
    outputKind: OutputKind
    unknownFlags: string[]
  }
>

export async function handleFix({
  autoMerge,
  cwd,
  ghsas,
  limit,
  minSatisfying,
  orgSlug,
  outputKind,
  prCheck,
  purls,
  rangeStyle,
  spinner,
  test,
  testScript,
  unknownFlags,
}: HandleFixConfig) {
  let { length: ghsasCount } = ghsas
  if (ghsasCount) {
    spinner?.start('Fetching GHSA IDs...')

    if (ghsasCount === 1 && ghsas[0] === 'auto') {
      const ghsasCResult = await spawnCoana(
        ['compute-fixes-and-upgrade-purls', cwd],
        { cwd, spinner },
      )

      spinner?.stop()

      if (ghsasCResult.ok) {
        const ghsasOutput = ghsasCResult.data as string
        ghsas = cmdFlagValueToArray(
          /(?<=Vulnerabilities found: )[^\n]+/.exec(ghsasOutput)?.[0],
        )
        ghsasCount = ghsas.length
      } else {
        debugFn('error', 'fail: Coana CLI')
        debugDir('inspect', {
          message: ghsasCResult.message,
          cause: ghsasCResult.cause,
        })
        ghsas = []
        ghsasCount = 0
      }

      spinner?.start()
    }

    if (ghsasCount) {
      spinner?.info(`Found ${ghsasCount} GHSA ${pluralize('ID', ghsasCount)}.`)

      const ghsaFixesCResult = await spawnCoana(
        [
          'compute-fixes-and-upgrade-purls',
          cwd,
          '--apply-fixes-to',
          ...ghsas,
          ...unknownFlags,
        ],
        { cwd, spinner },
      )

      spinner?.stop()

      if (!ghsaFixesCResult.ok) {
        debugFn('error', 'fail: Coana CLI')
        debugDir('inspect', {
          message: ghsaFixesCResult.message,
          cause: ghsaFixesCResult.cause,
        })
      }

      await outputFixResult(ghsaFixesCResult, outputKind)
      return
    }

    spinner?.infoAndStop('No GHSA IDs found.')

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

  // Lazily access constants.
  const { NPM, PNPM } = constants
  const { agent, agentVersion } = pkgEnvDetails
  if (agent !== NPM && agent !== PNPM) {
    await outputFixResult(
      {
        ok: false,
        message: 'Not supported.',
        cause: `${agent} v${agentVersion} is not supported by this command.`,
      },
      outputKind,
    )
    return
  }

  logger.info(`Fixing packages for ${agent} v${agentVersion}.\n`)

  const fixer = agent === NPM ? npmFix : pnpmFix
  await outputFixResult(
    await fixer(pkgEnvDetails, {
      autoMerge,
      cwd,
      limit,
      minSatisfying,
      prCheck,
      purls,
      rangeStyle,
      spinner,
      test,
      testScript,
    }),
    outputKind,
  )
}
