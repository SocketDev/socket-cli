import { VLT } from '@socketsecurity/lib-stable/constants/agents'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { applyOptimization } from './apply-optimization.mts'
import { outputOptimizeResult } from './output-optimize-result.mts'
import { runPastoralistAudit } from './pastoralist-audit.mts'
import { CMD_NAME } from './shared.mts'
import { syncOriginMain } from './sync-origin-main.mts'
import { detectAndValidatePackageEnvironment } from '../../util/ecosystem/environment.mjs'
import { cmdPrefixMessage } from '../../util/process/cmd.mts'

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
  const logger = getDefaultLogger()

  debug(`Starting optimization for ${cwd}`)
  debugDir({ cwd, outputKind, pin, prod })

  // Update the default branch to origin before reading any project state, so
  // the optimization runs against the latest project inputs. A skipped or
  // failed sync is logged and never fails the run.
  const syncResult = await syncOriginMain(cwd)
  debugDir({ syncOriginMain: syncResult })
  if (!syncResult.synced) {
    logger.info(`Origin sync skipped: ${syncResult.reason}.`)
  }

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
    `Detected package manager: ${pkgEnvDetails.agent} v${pkgEnvDetails.agentVersion.version}`,
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
          `${agent} v${agentVersion.version} does not support overrides.`,
        ),
      },
      outputKind,
    )
    return
  }

  logger.info(`Optimizing packages for ${agent} v${agentVersion.version}.`)
  logger.error('')

  // The pastoralist override audit runs ahead of socket's own overrides so
  // stale package-manager overrides carry their review record first. Its
  // errors are logged and swallowed inside the audit wrapper.
  const pastoralistResult = runPastoralistAudit(pkgEnvDetails.pkgPath)
  debugDir({ pastoralistAudit: pastoralistResult })
  if (!pastoralistResult.ok) {
    logger.warn(`Pastoralist audit skipped: ${pastoralistResult.reason}.`)
  }

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
