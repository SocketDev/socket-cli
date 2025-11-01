import { getDefaultLogger } from '@socketsecurity/lib/logger'

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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patches } = result.data

  if (outputKind === 'markdown') {
    if (patches.length === 0) {
      getDefaultLogger().log('## Discovered Patches\n\nNo patches discovered.')
      return
    }

    getDefaultLogger().log('## Discovered Patches\n')
    for (const patch of patches) {
      getDefaultLogger().log(`### ${patch.purl}\n`)
      if (patch.uuid) {
        getDefaultLogger().log(`**UUID**: ${patch.uuid}\n`)
      }
      if (patch.description) {
        getDefaultLogger().log(`**Description**: ${patch.description}\n`)
      }
      if (patch.tier) {
        getDefaultLogger().log(`**Tier**: ${patch.tier}`)
      }
      if (patch.license) {
        getDefaultLogger().log(`**License**: ${patch.license}`)
      }

      // Free CVEs.
      const freeCveCount = patch.freeCves.length
      if (freeCveCount > 0) {
        getDefaultLogger().log(`\n**Free CVEs**: ${freeCveCount}`)
        for (const vuln of patch.freeCves) {
          const cveStr = vuln.cve || 'Unknown'
          const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
          getDefaultLogger().log(`  - ${cveStr}${severityStr}`)
        }
      }

      // Enterprise CVEs.
      const paidCveCount = patch.paidCves.length
      if (paidCveCount > 0) {
        getDefaultLogger().log(`\n**Enterprise CVEs**: ${paidCveCount}`)
        for (const vuln of patch.paidCves) {
          const cveStr = vuln.cve || 'Unknown'
          const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
          getDefaultLogger().log(`  - ${cveStr}${severityStr}`)
        }
      }

      // Free Features.
      if (patch.freeFeatures?.length) {
        getDefaultLogger().log('\n**Free Features**:')
        for (const feature of patch.freeFeatures) {
          getDefaultLogger().log(`  - ${feature}`)
        }
      }

      // Enterprise Features.
      if (patch.paidFeatures?.length) {
        getDefaultLogger().log('\n**Enterprise Features**:')
        for (const feature of patch.paidFeatures) {
          getDefaultLogger().log(`  - ${feature}`)
        }
      }

      getDefaultLogger().log('')
    }
    return
  }

  // Default output.
  if (patches.length === 0) {
    return
  }

  getDefaultLogger().group('')
  for (const patch of patches) {
    getDefaultLogger().log(`- ${patch.purl}`)
    getDefaultLogger().group()
    if (patch.uuid) {
      getDefaultLogger().log(`UUID: ${patch.uuid}`)
    }
    if (patch.description) {
      getDefaultLogger().log(`Description: ${patch.description}`)
    }
    if (patch.tier) {
      getDefaultLogger().log(`Tier: ${patch.tier}`)
    }
    if (patch.license) {
      getDefaultLogger().log(`License: ${patch.license}`)
    }

    // Free CVEs.
    const freeCveCount = patch.freeCves.length
    if (freeCveCount > 0) {
      getDefaultLogger().log(`Free CVEs: ${freeCveCount}`)
      for (const vuln of patch.freeCves) {
        const cveStr = vuln.cve || 'Unknown'
        const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
        getDefaultLogger().log(`  - ${cveStr}${severityStr}`)
      }
    }

    // Enterprise CVEs.
    const paidCveCount = patch.paidCves.length
    if (paidCveCount > 0) {
      getDefaultLogger().log(`Enterprise CVEs: ${paidCveCount}`)
      for (const vuln of patch.paidCves) {
        const cveStr = vuln.cve || 'Unknown'
        const severityStr = vuln.severity ? ` (${vuln.severity})` : ''
        getDefaultLogger().log(`  - ${cveStr}${severityStr}`)
      }
    }

    // Free Features.
    if (patch.freeFeatures?.length) {
      getDefaultLogger().log('Free Features:')
      for (const feature of patch.freeFeatures) {
        getDefaultLogger().log(`  - ${feature}`)
      }
    }

    // Enterprise Features.
    if (patch.paidFeatures?.length) {
      getDefaultLogger().log('Enterprise Features:')
      for (const feature of patch.paidFeatures) {
        getDefaultLogger().log(`  - ${feature}`)
      }
    }

    getDefaultLogger().groupEnd()
  }
  getDefaultLogger().groupEnd()
}
