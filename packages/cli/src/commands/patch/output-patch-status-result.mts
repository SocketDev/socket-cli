import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { failMsgWithBadge } from '../../utils/error/fail-msg-with-badge.mts'
import { mdHeader, mdKeyValue } from '../../utils/output/markdown.mts'
import { serializeResultJson } from '../../utils/output/result-json.mjs'

import type { PatchStatus } from './handle-patch-status.mts'
import type { CResult, OutputKind } from '../../types.mts'

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
    getDefaultLogger().log(serializeResultJson(result))
    return
  }

  if (!result.ok) {
    getDefaultLogger().fail(failMsgWithBadge(result.message, result.cause))
    return
  }

  const { statuses } = result.data

  if (outputKind === 'markdown') {
    if (statuses.length === 0) {
      getDefaultLogger().log(
        `${mdHeader('Patch Status', 2)}\n\nNo patches found.`,
      )
      return
    }

    getDefaultLogger().log(`${mdHeader('Patch Status', 2)}\n`)

    for (const status of statuses) {
      const indicator = STATUS_INDICATORS[status.status]
      const statusName = STATUS_NAMES[status.status]

      getDefaultLogger().log(`${mdHeader(`${indicator} ${status.purl}`, 3)}\n`)
      getDefaultLogger().log(`${mdKeyValue('Status', statusName)}\n`)

      if (status.uuid) {
        getDefaultLogger().log(`${mdKeyValue('UUID', status.uuid)}\n`)
      }

      if (status.description) {
        getDefaultLogger().log(
          `${mdKeyValue('Description', status.description)}\n`,
        )
      }

      if (status.downloadedAt) {
        getDefaultLogger().log(mdKeyValue('Downloaded', status.downloadedAt))
      }

      if (status.appliedAt) {
        getDefaultLogger().log(mdKeyValue('Applied', status.appliedAt))
      }

      getDefaultLogger().log(mdKeyValue('Files', status.fileCount))
      getDefaultLogger().log(
        mdKeyValue('Vulnerabilities', status.vulnerabilityCount),
      )

      if (status.appliedLocations.length > 0) {
        getDefaultLogger().log('**Locations**:')
        for (const location of status.appliedLocations) {
          getDefaultLogger().log(`- ${location}`)
        }
      }

      getDefaultLogger().log(
        mdKeyValue('Backup Available', status.backupAvailable ? 'Yes' : 'No'),
      )
      getDefaultLogger().log('')
    }

    // Legend.
    getDefaultLogger().log(
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

  getDefaultLogger().group('')

  for (const status of statuses) {
    const indicator = STATUS_INDICATORS[status.status]
    const statusName = STATUS_NAMES[status.status]

    getDefaultLogger().log(`${indicator} ${status.purl}`)
    getDefaultLogger().group()

    getDefaultLogger().log(`Status: ${statusName}`)

    if (status.uuid) {
      getDefaultLogger().log(`UUID: ${status.uuid}`)
    }

    if (status.description) {
      getDefaultLogger().log(`Description: ${status.description}`)
    }

    if (status.downloadedAt) {
      getDefaultLogger().log(`Downloaded: ${status.downloadedAt}`)
    }

    if (status.appliedAt) {
      getDefaultLogger().log(`Applied: ${status.appliedAt}`)
    }

    getDefaultLogger().log(`Files: ${status.fileCount}`)
    getDefaultLogger().log(`Vulnerabilities: ${status.vulnerabilityCount}`)

    if (status.appliedLocations.length > 0) {
      getDefaultLogger().log('Locations:')
      getDefaultLogger().group()
      for (const location of status.appliedLocations) {
        getDefaultLogger().log(`- ${location}`)
      }
      getDefaultLogger().groupEnd()
    }

    getDefaultLogger().log(
      `Backup: ${status.backupAvailable ? 'Available' : 'Not available'}`,
    )

    getDefaultLogger().groupEnd()
  }

  getDefaultLogger().groupEnd()

  // Legend.
  getDefaultLogger().log('')
  getDefaultLogger().log('Legend:')
  getDefaultLogger().log(
    '  [✓] Applied    [○] Downloaded    [✗] Failed    [?] Unknown',
  )
}
