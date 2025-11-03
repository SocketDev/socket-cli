import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdKeyValue } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchListEntry } from './handle-patch-list.mts'
import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()


type CleanedPatchEntry = {
  appliedAt?: string
  description?: string
  exportedAt: string
  fileCount: number
  license?: string
  purl: string
  status?: string
  tier?: string
  uuid?: string
  vulnerabilityCount: number
}

type PatchListResultData = {
  patches: PatchListEntry[]
}

const STATUS_INDICATORS = {
  __proto__: null,
  applied: '[✓]',
  downloaded: '[○]',
  failed: '[✗]',
}

function getStatusIndicator(status: string | undefined): string {
  if (!status) {
    return '[○]' // Default to downloaded if no status
  }
  return STATUS_INDICATORS[status as keyof typeof STATUS_INDICATORS] || '[?]'
}

export async function outputPatchListResult(
  result: CResult<PatchListResultData>,
  outputKind: OutputKind,
): Promise<void> {
  if (!result.ok) {
    process.exitCode = result.code ?? 1
  }

  if (outputKind === 'json') {
    if (result.ok) {
      // Remove undefined fields from patches for clean JSON output.
      const cleanedPatches = result.data.patches.map(patch => {
        const cleaned: CleanedPatchEntry = {
          exportedAt: patch.exportedAt,
          fileCount: patch.fileCount,
          purl: patch.purl,
          vulnerabilityCount: patch.vulnerabilityCount,
        }
        if (patch.uuid !== undefined) {
          cleaned.uuid = patch.uuid
        }
        if (patch.description !== undefined) {
          cleaned.description = patch.description
        }
        if (patch.tier !== undefined) {
          cleaned.tier = patch.tier
        }
        if (patch.license !== undefined) {
          cleaned.license = patch.license
        }
        if (patch.status !== undefined) {
          cleaned.status = patch.status
        }
        if (patch.appliedAt !== undefined) {
          cleaned.appliedAt = patch.appliedAt
        }
        return cleaned
      })
      logger.log(
        serializeResultJson({
          ok: true,
          data: { patches: cleanedPatches },
        }),
      )
    } else {
      logger.log(serializeResultJson(result))
    }
    return
  }

  if (!result.ok) {
    logger.fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { patches } = result.data

  if (outputKind === 'markdown') {
    if (patches.length === 0) {
      logger.log(`${mdHeader('Patches', 2)}\n\nNo patches found.`)
      return
    }

    logger.log(`${mdHeader('Patches', 2)}\n`)
    for (const patch of patches) {
      const indicator = getStatusIndicator(patch.status)
      logger.log(`${mdHeader(`${indicator} ${patch.purl}`, 3)}\n`)
      if (patch.status) {
        const statusName =
          patch.status.charAt(0).toUpperCase() + patch.status.slice(1)
        logger.log(`${mdKeyValue('Status', statusName)}\n`)
      }
      if (patch.uuid) {
        logger.log(`${mdKeyValue('UUID', patch.uuid)}\n`)
      }
      logger.log(
        `${mdKeyValue('Description', patch.description || 'No description provided')}\n`,
      )
      logger.log(mdKeyValue('Exported', patch.exportedAt))
      if (patch.appliedAt) {
        logger.log(mdKeyValue('Applied', patch.appliedAt))
      }
      logger.log(mdKeyValue('Files', patch.fileCount))
      logger.log(
        mdKeyValue('Vulnerabilities', patch.vulnerabilityCount),
      )
      if (patch.tier) {
        logger.log(mdKeyValue('Tier', patch.tier))
      }
      if (patch.license) {
        logger.log(mdKeyValue('License', patch.license))
      }
      logger.log('')
    }
    logger.log(
      `${mdKeyValue('Legend', '[✓] Applied | [○] Downloaded | [✗] Failed')}`,
    )
    return
  }

  // Default output.
  if (patches.length === 0) {
    return
  }

  logger.group('')
  for (const patch of patches) {
    const indicator = getStatusIndicator(patch.status)
    logger.log(`${indicator} ${patch.purl}`)
    logger.group()
    if (patch.status) {
      const statusName =
        patch.status.charAt(0).toUpperCase() + patch.status.slice(1)
      logger.log(`Status: ${statusName}`)
    }
    if (patch.uuid) {
      logger.log(`UUID: ${patch.uuid}`)
    }
    logger.log(
      `Description: ${patch.description || 'No description provided'}`,
    )
    logger.log(`Exported: ${patch.exportedAt}`)
    if (patch.appliedAt) {
      logger.log(`Applied: ${patch.appliedAt}`)
    }
    logger.log(`Files: ${patch.fileCount}`)
    logger.log(`Vulnerabilities: ${patch.vulnerabilityCount}`)
    if (patch.tier) {
      logger.log(`Tier: ${patch.tier}`)
    }
    if (patch.license) {
      logger.log(`License: ${patch.license}`)
    }
    logger.groupEnd()
  }
  logger.groupEnd()

  // Legend.
  logger.log('')
  logger.log('Legend: [✓] Applied | [○] Downloaded | [✗] Failed')
}
