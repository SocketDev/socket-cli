import { PNPM } from '@socketsecurity/lib-stable/constants/agents'
import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { CMD_NAME } from './shared.mts'
import { detectAndValidatePackageEnvironment } from '../../util/ecosystem/environment.mjs'
import { ensurePnpmWorkspaceMinReleaseAge } from '../optimize/update-pnpm-workspace-yaml.mts'
import { cmdPrefixMessage } from '../../util/process/cmd.mts'

import type { CResult } from '../../types.mts'
import type { MinReleaseAgeOutcome } from '../optimize/update-pnpm-workspace-yaml.mts'
import type { OutputKind } from '../../types.mts'

export type DoctorReport = {
  minReleaseAge:
    | { enforceable: false; outcome: 'non-pnpm'; agent: string }
    | { enforceable: true; outcome: MinReleaseAgeOutcome }
}

/**
 * The dependency-health gate. First policy: soak-time - every run enforces a
 * minimum release age on the repo's package manager so fresh-publish
 * resolutions never land. Non-pnpm repos get the warning instead of a silent
 * pass (npm/yarn have no equivalent knob).
 */
export async function handleDoctor({
  cwd,
  outputKind,
}: {
  cwd: string
  outputKind: OutputKind
}): Promise<void> {
  const logger = getDefaultLogger()

  debug(`Starting dependency health check for ${cwd}`)
  debugDir({ cwd, outputKind })

  const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
    cmdName: CMD_NAME,
    logger,
  })
  if (!pkgEnvCResult.ok || !pkgEnvCResult.data) {
    process.exitCode = pkgEnvCResult.ok ? 1 : (pkgEnvCResult.code ?? 1)
    debug('Package environment validation failed')
    debugDir({ pkgEnvCResult })
    if (outputKind === 'json') {
      logger.log(
        JSON.stringify(
          pkgEnvCResult.ok
            ? { ok: false, message: 'No package found.' }
            : pkgEnvCResult,
          undefined,
          2,
        ),
      )
    } else {
      logger.fail(
        pkgEnvCResult.ok
          ? cmdPrefixMessage(CMD_NAME, 'No package found.')
          : cmdPrefixMessage(
              CMD_NAME,
              pkgEnvCResult.cause ?? pkgEnvCResult.message,
            ),
      )
    }
    return
  }

  const { agent, pkgPath } = pkgEnvCResult.data

  if (agent !== PNPM) {
    const report: DoctorReport = {
      minReleaseAge: { agent, enforceable: false, outcome: 'non-pnpm' },
    }
    debugDir({ doctorReport: report })
    if (outputKind === 'json') {
      logger.log(JSON.stringify(report, undefined, 2))
      return
    }
    logger.warn(
      cmdPrefixMessage(
        CMD_NAME,
        `soak-time: not enforceable under ${agent} (minimumReleaseAge is a pnpm knob).`,
      ),
    )
    return
  }

  const outcome = await ensurePnpmWorkspaceMinReleaseAge(pkgPath)
  const report: DoctorReport = {
    minReleaseAge: { enforceable: true, outcome },
  }
  debugDir({ doctorReport: report })
  if (outputKind === 'json') {
    logger.log(JSON.stringify(report, undefined, 2))
    return
  }
  const line =
    outcome === 'added'
      ? 'soak-time: enforced at 7 days (minimumReleaseAge added to pnpm-workspace.yaml).'
      : outcome === 'raised'
        ? 'soak-time: raised to 7 days in pnpm-workspace.yaml.'
        : 'soak-time: already enforced at 7 days.'
  logger.info(cmdPrefixMessage(CMD_NAME, line))
}
