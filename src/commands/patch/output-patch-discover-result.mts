import { logger } from '@socketsecurity/lib/logger'

import { OUTPUT_JSON } from '../../constants/cli.mjs'
import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { DiscoveredPatch } from './handle-patch-discover.mts'
import type { CResult, OutputKind } from '../../types.mts'

type PatchDiscoverResultData = {
  patches: DiscoveredPatch[]
}

export async function outputPatchDiscoverResult(
  result: CResult<PatchDiscoverResultData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === OUTPUT_JSON) {
    logger.log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patches } = result.data

  if (outputKind === 'markdown') {
    if (patches.length === 0) {
      logger.log('## Discovered Patches\n\nNo patches discovered.')
      return
    }

    logger.log('## Discovered Patches\n')
    for (const patch of patches) {
      logger.log(`### ${patch.purl}\n`)
      if (patch.uuid) {
        logger.log(`**UUID**: ${patch.uuid}\n`)
      }
      if (patch.description) {
        logger.log(`**Description**: ${patch.description}\n`)
      }
      if (patch.tier) {
        logger.log(`**Tier**: ${patch.tier}`)
      }
      if (patch.license) {
        logger.log(`**License**: ${patch.license}`)
      }

      // Free CVEs.
      const freeCveCount = patch.freeCves.length
      if (freeCveCount > 0) {
        logger.log(`\n**Free CVEs**: ${freeCveCount}`)
        for (const vuln of patch.freeCves) {
          const cveStr = vuln.cve || 'Unknown'
          const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
          logger.log(`  - ${cveStr}${severityStr}`)
        }
      }

      // Enterprise CVEs.
      const paidCveCount = patch.paidCves.length
      if (paidCveCount > 0) {
        logger.log(`\n**Enterprise CVEs**: ${paidCveCount}`)
        for (const vuln of patch.paidCves) {
          const cveStr = vuln.cve || 'Unknown'
          const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
          logger.log(`  - ${cveStr}${severityStr}`)
        }
      }

      // Free Features.
      if (patch.freeFeatures?.length) {
        logger.log(`\n**Free Features**:`)
        for (const feature of patch.freeFeatures) {
          logger.log(`  - ${feature}`)
        }
      }

      // Enterprise Features.
      if (patch.paidFeatures?.length) {
        logger.log(`\n**Enterprise Features**:`)
        for (const feature of patch.paidFeatures) {
          logger.log(`  - ${feature}`)
        }
      }

      logger.log('')
    }
    return
  }

  // Default output.
  if (patches.length === 0) {
    return
  }

  logger.group('')
  for (const patch of patches) {
    logger.log(`- ${patch.purl}`)
    logger.group()
    if (patch.uuid) {
      logger.log(`UUID: ${patch.uuid}`)
    }
    if (patch.description) {
      logger.log(`Description: ${patch.description}`)
    }
    if (patch.tier) {
      logger.log(`Tier: ${patch.tier}`)
    }
    if (patch.license) {
      logger.log(`License: ${patch.license}`)
    }

    // Free CVEs.
    const freeCveCount = patch.freeCves.length
    if (freeCveCount > 0) {
      logger.log(`Free CVEs: ${freeCveCount}`)
      for (const vuln of patch.freeCves) {
        const cveStr = vuln.cve || 'Unknown'
        const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
        logger.log(`  - ${cveStr}${severityStr}`)
      }
    }

    // Enterprise CVEs.
    const paidCveCount = patch.paidCves.length
    if (paidCveCount > 0) {
      logger.log(`Enterprise CVEs: ${paidCveCount}`)
      for (const vuln of patch.paidCves) {
        const cveStr = vuln.cve || 'Unknown'
        const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
        logger.log(`  - ${cveStr}${severityStr}`)
      }
    }

    // Free Features.
    if (patch.freeFeatures?.length) {
      logger.log(`Free Features:`)
      for (const feature of patch.freeFeatures) {
        logger.log(`  - ${feature}`)
      }
    }

    // Enterprise Features.
    if (patch.paidFeatures?.length) {
      logger.log(`Enterprise Features:`)
      for (const feature of patch.paidFeatures) {
        logger.log(`  - ${feature}`)
      }
    }

    logger.groupEnd()
  }
  logger.groupEnd()
}
