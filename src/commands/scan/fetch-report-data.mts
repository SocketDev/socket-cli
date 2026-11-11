import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { queryApiSafeText } from '../../utils/api.mts'
import { formatErrorWithDetail } from '../../utils/errors.mts'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'

export type FetchScanData = {
  includeLicensePolicy?: boolean | undefined
}

/** Fetch the scan data needed to generate a report. */
export async function fetchScanData(
  orgSlug: string,
  scanId: string,
  options?: FetchScanData | undefined,
): Promise<CResult<{ scan: SocketArtifact[] }>> {
  const { spinner } = constants
  spinner.start('Scan result: requested...')

  try {
    const result = await queryApiSafeText(
      `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${options?.includeLicensePolicy ? '?include_license_details=true' : ''}`,
    )

    if (!result.ok) {
      spinner.stop()
      logger.info('Scan result: request failed.')
      return result
    }

    const data: SocketArtifact[] = []
    for (const line of result.data.split('\n').filter(Boolean)) {
      try {
        data.push(JSON.parse(line))
      } catch (error) {
        debugFn('error', 'Failed to parse report data line as JSON')
        debugDir('error', { error, line })
        spinner.stop()
        logger.info('Scan result: received invalid JSON response.')
        return {
          ok: false,
          message: 'Invalid Socket API response',
          cause:
            'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
        }
      }
    }

    spinner.stop()
    logger.info('Scan result: success.')
    return { ok: true, data: { scan: data } }
  } catch (error) {
    spinner.stop()
    logger.info('Scan result: request failed.')
    return {
      ok: false,
      message: 'Socket API error',
      cause:
        formatErrorWithDetail('Error requesting scan', error) ||
        'Error requesting scan: (no error message found)',
    }
  }
}
