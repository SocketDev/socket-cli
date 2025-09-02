import { debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { coanaFix } from './coana-fix.mts'
import { npmFix } from './npm-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { pnpmFix } from './pnpm-fix.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
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
  if (ghsas.length) {
    await outputFixResult(
      await coanaFix({
        autoMerge,
        cwd,
        ghsas,
        limit,
        minSatisfying,
        orgSlug,
        prCheck,
        purls,
        rangeStyle,
        spinner,
        test,
        testScript,
        unknownFlags,
      }),
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

  debugDir('inspect', { pkgEnvDetails })

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
      ghsas,
      limit,
      minSatisfying,
      orgSlug,
      prCheck,
      purls,
      rangeStyle,
      spinner,
      test,
      testScript,
      unknownFlags,
    }),
    outputKind,
  )
}
