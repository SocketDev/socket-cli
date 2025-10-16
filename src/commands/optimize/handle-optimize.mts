import { VLT } from '@socketsecurity/registry/constants/agents'
import { debug, debugDir } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { applyOptimization } from './apply-optimization.mts'
import { outputOptimizeResult } from './output-optimize-result.mts'
import { CMD_NAME } from './shared.mts'
import { detectAndValidatePackageEnvironment } from '../../utils/ecosystem/environment.mjs'
import { cmdPrefixMessage } from '../../utils/process/cmd.mts'

import type { OutputKind } from '../../types.mts'

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
  debug(`Starting optimization for ${cwd}`)
  debugDir({ cwd, outputKind, pin, prod })

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
    prod,
  })
  if (!pkgEnvCResult.ok) {
    process.exitCode = pkgEnvCResult.code ?? 1
    debug('Package environment validation failed')
    debugDir({ pkgEnvCResult })
    await outputOptimizeResult(pkgEnvCResult, outputKind)
    return
  }

  const pkgEnvDetails = pkgEnvCResult.data
  if (!pkgEnvDetails) {
    process.exitCode = 1
    debug('No package environment details found')
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

  debug(
    `Detected package manager: ${pkgEnvDetails.agent} v${pkgEnvDetails.agentVersion}`,
  )
  debugDir({ pkgEnvDetails })

  const { agent, agentVersion } = pkgEnvDetails
  if (agent === VLT) {
    process.exitCode = 1
    debug(`${agent} does not support overrides`)
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

  debug('Applying optimization')
  const optimizationResult = await applyOptimization(pkgEnvDetails, {
    pin,
    prod,
  })

  if (!optimizationResult.ok) {
    process.exitCode = optimizationResult.code ?? 1
  }
  debug(`Optimization ${optimizationResult.ok ? 'succeeded' : 'failed'}`)
  debugDir({ optimizationResult })
  await outputOptimizeResult(optimizationResult, outputKind)
}
