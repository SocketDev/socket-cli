import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { coanaFix } from './coana-fix.mts'
import { outputFixResult } from './output-fix-result.mts'
import { resolveAdvisoryIds } from '../../utils/advisory-ids.mts'

import type { FixConfig } from './types.mts'
import type { OutputKind } from '../../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'

export type HandleFixConfig = Remap<
  FixConfig & {
    applyFixes: boolean
    coanaVersion?: string | undefined
    ghsas: string[]
    orgSlug: string
    outputKind: OutputKind
    unknownFlags: string[]
  }
>

type ConvertIdsOptions = {
  silence?: boolean | undefined
}

/**
 * Converts mixed CVE/GHSA/PURL IDs to GHSA IDs only.
 * Filters out invalid IDs and logs conversion results.
 */
export async function convertIdsToGhsas(
  ids: string[],
  options?: ConvertIdsOptions | undefined,
): Promise<string[]> {
  const { silence = false } = {
    __proto__: null,
    ...options,
  } as ConvertIdsOptions
  debugFn('notice', `Converting ${ids.length} IDs to GHSA format`)
  debugDir('inspect', { ids })

  const { errors, ghsas: validGhsas } = await resolveAdvisoryIds(ids, {
    silence,
  })

  if (errors.length) {
    if (!silence) {
      logger.warn(
        `Skipped ${errors.length} invalid IDs:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      )
    }
    debugDir('inspect', { errors })
  }

  debugFn('notice', `Converted to ${validGhsas.length} valid GHSA IDs`)
  debugDir('inspect', { validGhsas })

  return validGhsas
}

export async function handleFix({
  all,
  allowOverrides,
  applyFixes,
  autopilot,
  coanaVersion,
  cwd,
  debug,
  disableExternalToolChecks,
  disableMajorUpdates,
  dynamicSbomInference,
  ecosystems,
  exclude,
  excludePaths,
  ghsas,
  include,
  minSatisfying,
  minimumReleaseAge,
  orgSlug,
  outputFile,
  outputKind,
  packageManagers,
  prCheck,
  prLimit,
  rangeStyle,
  showAffectedDirectDependencies,
  silence,
  spinner,
  unknownFlags,
}: HandleFixConfig) {
  debugFn('notice', `Starting fix command for ${orgSlug}`)
  debugDir('inspect', {
    all,
    allowOverrides,
    applyFixes,
    autopilot,
    coanaVersion,
    cwd,
    debug,
    disableExternalToolChecks,
    disableMajorUpdates,
    dynamicSbomInference,
    ecosystems,
    exclude,
    excludePaths,
    ghsas,
    include,
    minSatisfying,
    minimumReleaseAge,
    outputFile,
    outputKind,
    packageManagers,
    prCheck,
    prLimit,
    rangeStyle,
    showAffectedDirectDependencies,
    silence,
    unknownFlags,
  })

  await outputFixResult(
    await coanaFix({
      all,
      allowOverrides,
      applyFixes,
      autopilot,
      coanaVersion,
      cwd,
      debug,
      disableExternalToolChecks,
      disableMajorUpdates,
      dynamicSbomInference,
      ecosystems,
      exclude,
      excludePaths,
      // Convert mixed CVE/GHSA/PURL inputs to GHSA IDs only.
      ghsas: await convertIdsToGhsas(ghsas, { silence }),
      include,
      minimumReleaseAge,
      minSatisfying,
      orgSlug,
      outputFile,
      packageManagers,
      prCheck,
      prLimit,
      rangeStyle,
      showAffectedDirectDependencies,
      silence,
      spinner,
      unknownFlags,
    }),
    outputKind,
  )
}
