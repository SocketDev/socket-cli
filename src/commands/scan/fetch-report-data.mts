import { debugFn } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import { handleApiCallNoSpinner, queryApiSafeText } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketArtifact } from '../../utils/alert/artifact.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'

/**
 * This fetches all the relevant pieces of data to generate a report, given a
 * full scan ID.
 */
export async function fetchReportData(
  orgSlug: string,
  scanId: string,
  includeLicensePolicy: boolean,
): Promise<
  CResult<{
    scan: SocketArtifact[]
    securityPolicy: SocketSdkReturnType<'getOrgSecurityPolicy'>['data']
  }>
> {
  const sockSdkResult = await setupSdk()
  if (!sockSdkResult.ok) {
    return sockSdkResult
  }
  const sockSdk = sockSdkResult.data

  let policyStatus = 'requested...'
  let scanStatus = 'requested...'
  let finishedFetching = false

  // Lazily access constants.spinner.
  const { spinner } = constants

  function updateScan(desc: string) {
    scanStatus = desc
    updateProgress()
  }

  function updatePolicy(desc: string) {
    policyStatus = desc
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

    updateScan(`response received`)

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
      } catch {
        ok = false
        debugFn('fail: parse NDJSON\n', line)
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
      message: 'Invalid API response',
      cause:
        'The API responded with at least one line that was not valid JSON. Please report if this persists.',
    }
  }

  async function fetchSecurityPolicy(): Promise<
    CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>
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
    CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>,
  ] = await Promise.all([
    fetchScanResult().catch(e => {
      updateScan('failure; unknown blocking problem occurred')
      return {
        ok: false as const,
        message: 'Unexpected API problem',
        cause: `We encountered an unexpected problem while requesting the Scan from the API: ${e?.message || '(no error message found)'}${e?.cause ? ` (cause: ${e.cause})` : ''}`,
      }
    }),
    fetchSecurityPolicy().catch(e => {
      updatePolicy('failure; unknown blocking problem occurred')
      return {
        ok: false as const,
        message: 'Unexpected API problem',
        cause: `We encountered an unexpected problem while requesting the policy from the API: ${e?.message || '(no error message found)'}${e?.cause ? ` (cause: ${e.cause})` : ''}`,
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
