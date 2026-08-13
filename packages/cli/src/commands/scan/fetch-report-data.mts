import { debug, debugDir } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { getDefaultSpinner } from '@socketsecurity/lib-stable/spinner/default'

import { formatErrorWithDetail } from '../../util/error/errors.mjs'
import { queryApiSafeText } from '../../util/socket/api.mjs'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../util/alert/artifact.mts'

const logger = getDefaultLogger()

export type FetchScanData = {
  includeLicensePolicy?: boolean | undefined
}

/**
 * This fetches all the relevant pieces of data to generate a report, given a
 * full scan ID.
 */
export async function fetchScanData(
  orgSlug: string,
  scanId: string,
  options?: FetchScanData | undefined,
): Promise<CResult<{ scan: SocketArtifact[] }>> {
  const includeLicensePolicy = options?.includeLicensePolicy
  const spinner = getDefaultSpinner()

  let scanStatus = 'requested…'
  let finishedFetching = false

  function updateScan(status: string) {
    scanStatus = status
    updateProgress()
  }

  function updateProgress() {
    if (finishedFetching) {
      spinner.stop()
      logger.info(`Scan result: ${scanStatus}.`)
    } else {
      spinner.start(`Scan result: ${scanStatus}.`)
    }
  }

  updateProgress()

  try {
    const result = await queryApiSafeText(
      `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${includeLicensePolicy ? '?include_license_details=true' : ''}`,
    )

    updateScan('response received')

    if (!result.ok) {
      finishedFetching = true
      updateProgress()
      return result
    }

    const ndJsonString = result.data

    // This is nd-json; each line is a json object.
    const lines = ndJsonString.split(/\r?\n/).filter(Boolean)
    const data: SocketArtifact[] = []
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]!
      try {
        data.push(JSON.parse(line))
      } catch (e) {
        debug('Failed to parse report data line (invalid JSON)')
        debugDir({ error: e, line })
        updateScan('received invalid JSON response')
        finishedFetching = true
        updateProgress()
        return {
          ok: false,
          message: 'Invalid Socket API response',
          cause:
            'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
        }
      }
    }

    updateScan('success')
    finishedFetching = true
    updateProgress()

    return {
      ok: true,
      data: {
        scan: data,
      },
    }
  } catch (e) {
    updateScan('failure; unknown blocking error occurred')
    finishedFetching = true
    updateProgress()
    return {
      ok: false,
      message: 'Socket API error',
      cause:
        formatErrorWithDetail('Error requesting scan', e) ||
        'Error requesting scan: (no error message found)',
    }
  }
}
