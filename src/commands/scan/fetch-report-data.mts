import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants.mts'
import {
  handleApiCallNoSpinner,
  handleApiError,
  queryApi,
  tmpHandleApiCall
} from '../../utils/api.mts'
import { getDefaultToken, setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SocketSdkReturnType } from '@socketsecurity/sdk'
import type { components } from '@socketsecurity/sdk/types/api'

/**
 * This fetches all the relevant pieces of data to generate a report, given a
 * full scan ID.
 */
export async function fetchReportData(
  orgSlug: string,
  scanId: string,
  includeLicensePolicy: boolean
): Promise<
  CResult<{
    scan: Array<components['schemas']['SocketArtifact']>
    securityPolicy: SocketSdkReturnType<'getOrgSecurityPolicy'>['data']
  }>
> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    return {
      ok: false,
      message: 'Authentication Error',
      cause:
        'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    }
  }

  const sockSdk = await setupSdk(apiToken)

  let scanStatus = 'requested..'
  let policyStatus = 'requested..'
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
      logger.error(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`
      )
    } else {
      spinner.start(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`
      )
    }
  }

  async function fetchScanResult(
    apiToken: string
  ): Promise<CResult<Array<components['schemas']['SocketArtifact']>>> {
    const response = await tmpHandleApiCall(
      queryApi(
        `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${includeLicensePolicy ? '?include_license_details=true' : ''}`,
        apiToken
      ),
      'fetchScanResult'
    )

    updateScan('received response')

    if (!response.ok) {
      const err = await handleApiError(response.status)
      updateScan(`request resulted in status code ${response.status}`)
      return {
        ok: false,
        message: 'Socket API returned an error',
        cause: `${response.statusText}${err ? ` (cause: ${err})` : ''}`
      }
    }

    updateScan(`ok, downloading response..`)
    const jsons = await response.text()
    updateScan(`received policy`)

    const lines = jsons.split('\n').filter(Boolean)
    const data = lines.map(line => {
      try {
        return JSON.parse(line)
      } catch {
        scanStatus = `received invalid JSON response`
        spinner.stop()
        logger.error(
          'Response was not valid JSON but it ought to be (please report if this persists)'
        )
        debugLog(line)
        updateProgress()
        return
      }
    }) as unknown as Array<components['schemas']['SocketArtifact']>

    return { ok: true, data }
  }

  async function fetchSecurityPolicy(): Promise<
    CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>
  > {
    const result = await handleApiCallNoSpinner(
      sockSdk.getOrgSecurityPolicy(orgSlug),
      'GetOrgSecurityPolicy'
    )

    updatePolicy('received policy')

    return result
  }

  updateProgress()

  const [scan, securityPolicy]: [
    CResult<Array<components['schemas']['SocketArtifact']>>,
    CResult<SocketSdkReturnType<'getOrgSecurityPolicy'>['data']>
  ] = await Promise.all([
    fetchScanResult(apiToken).catch(e => {
      updateScan(`failure; unknown blocking problem occurred`)
      return {
        ok: false as const,
        message: 'Unexpected API problem',
        cause: `We encountered an unexpected problem while requesting the Scan from the API: ${e?.message || '(no error message found)'}${e?.cause ? ` (cause: ${e.cause})` : ''}'}`
      }
    }),
    fetchSecurityPolicy().catch(e => {
      updatePolicy(`failure; unknown blocking problem occurred`)
      return {
        ok: false as const,
        message: 'Unexpected API problem',
        cause: `We encountered an unexpected problem while requesting the policy from the API: ${e?.message || '(no error message found)'}${e?.cause ? ` (cause: ${e.cause})` : ''}'}`
      }
    })
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
      cause: 'Was unable to fetch scan result, bailing'
    }
  }

  return {
    ok: true,
    data: {
      scan: scan.data satisfies Array<components['schemas']['SocketArtifact']>,
      securityPolicy: securityPolicy.data
    }
  }
}
