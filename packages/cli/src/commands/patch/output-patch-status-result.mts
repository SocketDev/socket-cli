import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdKeyValue } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchStatus } from './handle-patch-status.mts'
import type { CResult, OutputKind } from '../../types.mts'
const logger = getDefaultLogger()

type PatchStatusResultData = {
  statuses: PatchStatus[]
}

const STATUS_INDICATORS = {
  __proto__: null,
  applied: '[✓]',
  downloaded: '[○]',
  failed: '[✗]',
  unknown: '[?]',
}

const STATUS_NAMES = {
  __proto__: null,
  applied: 'Applied',
  downloaded: 'Downloaded',
  failed: 'Failed',
  unknown: 'Unknown',
}

export async function outputPatchStatusResult(
  result: CResult<PatchStatusResultData>,
  outputKind: OutputKind,
): Promise<void> {
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

  const { statuses } = result.data

  if (outputKind === 'markdown') {
    if (statuses.length === 0) {
      logger.log(`${mdHeader('Patch Status', 2)}\n\nNo patches found.`)
      return
    }

    logger.log(`${mdHeader('Patch Status', 2)}\n`)

    for (const status of statuses) {
      const indicator = STATUS_INDICATORS[status.status]
      const statusName = STATUS_NAMES[status.status]

      logger.log(`${mdHeader(`${indicator} ${status.purl}`, 3)}\n`)
      logger.log(`${mdKeyValue('Status', statusName)}\n`)

      if (status.uuid) {
        logger.log(`${mdKeyValue('UUID', status.uuid)}\n`)
      }

      if (status.description) {
        logger.log(`${mdKeyValue('Description', status.description)}\n`)
      }

      if (status.downloadedAt) {
        logger.log(mdKeyValue('Downloaded', status.downloadedAt))
      }

      if (status.appliedAt) {
        logger.log(mdKeyValue('Applied', status.appliedAt))
      }

      logger.log(mdKeyValue('Files', status.fileCount))
      logger.log(mdKeyValue('Vulnerabilities', status.vulnerabilityCount))

      if (status.appliedLocations.length > 0) {
        logger.log('**Locations**:')
        for (const location of status.appliedLocations) {
          logger.log(`- ${location}`)
        }
      }

      logger.log(
        mdKeyValue('Backup Available', status.backupAvailable ? 'Yes' : 'No'),
      )
      logger.log('')
    }

    // Legend.
    logger.log(
      mdKeyValue(
        'Legend',
        '[✓] Applied | [○] Downloaded | [✗] Failed | [?] Unknown',
      ),
    )

    return
  }

  // Default output.
  if (statuses.length === 0) {
    return
  }

  logger.group('')

  for (const status of statuses) {
    const indicator = STATUS_INDICATORS[status.status]
    const statusName = STATUS_NAMES[status.status]

    logger.log(`${indicator} ${status.purl}`)
    logger.group()

    logger.log(`Status: ${statusName}`)

    if (status.uuid) {
      logger.log(`UUID: ${status.uuid}`)
    }

    if (status.description) {
      logger.log(`Description: ${status.description}`)
    }

    if (status.downloadedAt) {
      logger.log(`Downloaded: ${status.downloadedAt}`)
    }

    if (status.appliedAt) {
      logger.log(`Applied: ${status.appliedAt}`)
    }

    logger.log(`Files: ${status.fileCount}`)
    logger.log(`Vulnerabilities: ${status.vulnerabilityCount}`)

    if (status.appliedLocations.length > 0) {
      logger.log('Locations:')
      logger.group()
      for (const location of status.appliedLocations) {
        logger.log(`- ${location}`)
      }
      logger.groupEnd()
    }

    logger.log(
      `Backup: ${status.backupAvailable ? 'Available' : 'Not available'}`,
    )

    logger.groupEnd()
  }

  logger.groupEnd()

  // Legend.
  logger.log('')
  logger.log('Legend:')
  logger.log('  [✓] Applied    [○] Downloaded    [✗] Failed    [?] Unknown')
}
