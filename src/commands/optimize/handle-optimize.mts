import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
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
  debugFn('notice', `Starting optimization for ${cwd}`)
  debugDir('inspect', { cwd, outputKind, pin, prod })

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
    prod,
  })
  if (!pkgEnvCResult.ok) {
    debugFn('warn', 'Package environment validation failed')
    debugDir('inspect', { pkgEnvCResult })
    await outputOptimizeResult(pkgEnvCResult, outputKind)
    return
  }

  const pkgEnvDetails = pkgEnvCResult.data
  if (!pkgEnvDetails) {
    debugFn('warn', 'No package environment details found')
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

  debugFn('notice', `Detected package manager: ${pkgEnvDetails.agent} v${pkgEnvDetails.agentVersion}`)
  debugDir('inspect', { pkgEnvDetails })

  const { agent, agentVersion } = pkgEnvDetails
  if (agent === VLT) {
    debugFn('warn', `${agent} does not support overrides`)
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

  debugFn('notice', 'Applying optimization')
  const optimizationResult = await applyOptimization(pkgEnvDetails, { pin, prod })
  debugFn('notice', `Optimization ${optimizationResult.ok ? 'succeeded' : 'failed'}`)
  debugDir('inspect', { optimizationResult })

  await outputOptimizeResult(optimizationResult, outputKind)
}
