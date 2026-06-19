import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { isObject } from '@socketsecurity/registry/lib/objects'
import { pluralize } from '@socketsecurity/registry/lib/words'

import { failMsgWithBadge } from '../../utils/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/serialize-result-json.mts'

import type { FixMethodEntry } from './coana-fix.mts'
import type { CResult, OutputKind } from '../../types.mts'

export async function outputFixResult(
  result: CResult<unknown>,
  outputKind: OutputKind,
) {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    logger.log(serializeResultJson(result))
    return
  }
  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  // Surface how each vulnerability was resolved so customers can tell an
  // override (an npm `overrides` / pnpm `pnpm.overrides` entry written because
  // no upgrade satisfied the declared semver range) apart from a standard
  // upgrade. The breakdown is only shown when at least one override was
  // written; a run that resolved everything via upgrades keeps its prior,
  // quieter output.
  const data = isObject(result.data) ? result.data : undefined
  const fixMethods: FixMethodEntry[] =
    data && Array.isArray((data as { fixMethods?: unknown }).fixMethods)
      ? (data as { fixMethods: FixMethodEntry[] }).fixMethods
      : []
  const overrideFixes = fixMethods.filter(m => m.method === 'override')

  logger.log('')

  if (overrideFixes.length) {
    const overrideGhsaIds = arrayUnique(overrideFixes.map(m => m.ghsaId))
    logger.warn(
      `Resolved ${overrideGhsaIds.length} ${pluralize('vulnerability', overrideGhsaIds.length)} by writing overrides because no upgrade satisfied the declared semver range:`,
    )
    for (const { fixedVersion, ghsaId, purl } of overrideFixes) {
      logger.log(
        `  - ${ghsaId}: ${purl}${fixedVersion ? ` -> ${fixedVersion}` : ''} (override)`,
      )
    }
    const upgradeFixes = fixMethods.filter(m => m.method === 'upgrade')
    if (upgradeFixes.length) {
      const upgradeGhsaIds = arrayUnique(upgradeFixes.map(m => m.ghsaId))
      logger.info(
        `Resolved ${upgradeGhsaIds.length} ${pluralize('vulnerability', upgradeGhsaIds.length)} via a standard upgrade.`,
      )
    }
    logger.log('')
  }

  logger.success('Finished!')
}
