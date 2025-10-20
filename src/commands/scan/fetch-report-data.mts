import { debug, debugDir } from '@socketsecurity/lib/debug'
import { logger } from '@socketsecurity/lib/logger'
import { getSpinner } from '@socketsecurity/registry/constants/process'

import { formatErrorWithDetail } from '../../utils/error/errors.mjs'
import {
  handleApiCallNoSpinner,
  queryApiSafeText,
} from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchScanData = {
  includeLicensePolicy?: boolean | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

/**
 * This fetches all the relevant pieces of data to generate a report, given a
 * full scan ID.
 */
export async function fetchScanData(
  orgSlug: string,
  scanId: string,
  options?: FetchScanData | undefined,
): Promise<
  CResult<{
    scan: SocketArtifact[]
    securityPolicy: SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']
  }>
> {
  const { includeLicensePolicy, sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchScanData
  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  let policyStatus = 'requested...'
  let scanStatus = 'requested...'
  let finishedFetching = false

  const spinner = getSpinner()!

  function updateScan(status: string) {
    scanStatus = status
    updateProgress()
  }

  function updatePolicy(status: string) {
    policyStatus = status
    updateProgress()
  }

  function updateProgress() {
    if (finishedFetching) {
      spinner.stop()
      logger.info(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`,
      )
    } else {
      spinner.start(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`,
      )
    }
  }

  async function fetchScanResult(): Promise<CResult<SocketArtifact[]>> {
    const result = await queryApiSafeText(
      `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${includeLicensePolicy ? '?include_license_details=true' : ''}`,
    )

    updateScan('response received')

    if (!result.ok) {
      return result
    }

    const ndJsonString = result.data

    // This is nd-json; each line is a json object.
    const lines = ndJsonString.split('\n').filter(Boolean)
    let ok = true
    const data = lines.map(line => {
      try {
        return JSON.parse(line)
      } catch (e) {
        ok = false
        debug('Failed to parse report data line as JSON')
        debugDir({ error: e, line })
        return
      }
    }) as unknown as SocketArtifact[]

    if (ok) {
      updateScan('success')
      return { ok: true, data }
    }

    updateScan('received invalid JSON response')

    return {
      ok: false,
      message: 'Invalid Socket API response',
      cause:
        'The Socket API responded with at least one line that was not valid JSON. Please report if this persists.',
    }
  }

  async function fetchSecurityPolicy(): Promise<
    CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>
  > {
    const result = await handleApiCallNoSpinner(
      sockSdk.getOrgSecurityPolicy(orgSlug),
      'GetOrgSecurityPolicy',
    )

    updatePolicy('received policy')

    return result
  }

  updateProgress()

  const [scan, securityPolicy]: [
    CResult<SocketArtifact[]>,
    CResult<SocketSdkSuccessResult<'getOrgSecurityPolicy'>['data']>,
  ] = await Promise.all([
    fetchScanResult().catch(e => {
      updateScan('failure; unknown blocking error occurred')
      return {
        ok: false as const,
        message: 'Socket API error',
        cause:
          formatErrorWithDetail('Error requesting scan', e) ||
          'Error requesting scan: (no error message found)',
      }
    }),
    fetchSecurityPolicy().catch(e => {
      updatePolicy('failure; unknown blocking error occurred')
      return {
        ok: false as const,
        message: 'Socket API error',
        cause:
          formatErrorWithDetail('Error requesting policy', e) ||
          'Error requesting policy: (no error message found)',
      }
    }),
  ]).finally(() => {
    finishedFetching = true
    updateProgress()
  })

  if (!scan.ok) {
    return scan
  }
  if (!securityPolicy.ok) {
    return securityPolicy
  }

  if (!Array.isArray(scan.data)) {
    return {
      ok: false,
      message: 'Failed to fetch',
      cause: 'Was unable to fetch scan result, bailing',
    }
  }

  return {
    ok: true,
    data: {
      scan: scan.data satisfies SocketArtifact[],
      securityPolicy: securityPolicy.data,
    },
  }
}
