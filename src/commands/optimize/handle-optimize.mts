import { logger } from '@socketsecurity/registry/lib/logger'

import { applyOptimization } from './apply-optimization.mts'
import { outputOptimizeResult } from './output-optimize-result.mts'
import { CMD_NAME } from './shared.mts'
import constants from '../../constants.mts'
import { cmdPrefixMessage } from '../../utils/cmd.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/package-environment.mts'

import type { OutputKind } from '../../types.mts'

const { VLT } = constants

export async function handleOptimize({
  cwd,
  outputKind,
  pin,
  prod,
}: {
  cwd: string
  outputKind: OutputKind
  pin: boolean
  prod: boolean
}) {
  // Debug CI issues on Windows.
  if (process.env['CI']) {
    console.error(`[DEBUG] handleOptimize called:`)
    console.error(`  platform: ${process.platform}`)
    console.error(`  cwd: ${cwd}`)
    console.error(`  outputKind: ${outputKind}`)
    console.error(`  pin: ${pin}`)
    console.error(`  prod: ${prod}`)
    console.error(`  process.env.CI: ${process.env['CI']}`)
  }

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
    prod,
  })
  if (!pkgEnvCResult.ok) {
    await outputOptimizeResult(pkgEnvCResult, outputKind)
    return
  }

  const pkgEnvDetails = pkgEnvCResult.data
  if (!pkgEnvDetails) {
    await outputOptimizeResult(
      {
        ok: false,
        message: 'No package found.',
        cause: `No valid package environment found for project path: ${cwd}`,
      },
      outputKind,
    )
    return
  }

  const { agent, agentVersion } = pkgEnvDetails
  if (agent === VLT) {
    await outputOptimizeResult(
      {
        ok: false,
        message: 'Unsupported',
        cause: cmdPrefixMessage(
          CMD_NAME,
          `${agent} v${agentVersion} does not support overrides.`,
        ),
      },
      outputKind,
    )
    return
  }

  logger.info(`Optimizing packages for ${agent} v${agentVersion}.\n`)

  await outputOptimizeResult(
    await applyOptimization(pkgEnvDetails, { pin, prod }),
    outputKind,
  )
}
