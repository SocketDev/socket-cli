import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import constants from '../../constants'
import { handleApiCall, handleApiError, queryApi } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { failMsgWithBadge } from '../../utils/fail-msg-with-badge'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type {
  SocketSdkResultType,
  SocketSdkReturnType
} from '@socketsecurity/sdk'
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
  | {
      ok: true
      scan: Array<components['schemas']['SocketArtifact']>
      securityPolicy: SocketSdkReturnType<'getOrgSecurityPolicy'>
    }
  | {
      ok: false
      scan: undefined
      securityPolicy: undefined
    }
> {
  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
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
      logger.info(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`
      )
    } else {
      spinner.start(
        `Scan result: ${scanStatus}. Security policy: ${policyStatus}.`
      )
    }
  }

  async function fetchScanResult(apiToken: string) {
    const response = await queryApi(
      `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${includeLicensePolicy ? '?include_license_details=true' : ''}`,
      apiToken
    )
    updateScan('received response')

    if (!response.ok) {
      spinner.stop()
      const err = await handleApiError(response.status)
      logger.fail(failMsgWithBadge(response.statusText, `Fetch error: ${err}`))
      debugLog(err)
      updateScan(`request resulted in status code ${response.status}`)
      return undefined
    }

    updateScan(`ok, downloading response..`)
    const jsons = await response.text()
    updateScan(`received`)

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

    return data
  }

  async function fetchSecurityPolicy() {
    const r = await sockSdk.getOrgSecurityPolicy(orgSlug)
    updatePolicy('received response')

    const s = await handleApiCall(
      r,
      "looking up organization's security policy"
    )
    updatePolicy('received')
    return s
  }

  updateProgress()

  const [scan, securityPolicyMaybe]: [
    undefined | Array<components['schemas']['SocketArtifact']>,
    SocketSdkResultType<'getOrgSecurityPolicy'>
  ] = await Promise.all([
    fetchScanResult(apiToken).catch(e => {
      updateScan(`failure; unknown blocking problem occurred`)
      throw e
    }),
    fetchSecurityPolicy().catch(e => {
      updatePolicy(`failure; unknown blocking problem occurred`)
      throw e
    })
  ]).finally(() => {
    finishedFetching = true
    updateProgress()
  })

  if (!Array.isArray(scan)) {
    logger.error('Was unable to fetch scan result, bailing')
    process.exitCode = 1
    return {
      ok: false,
      scan: undefined,
      securityPolicy: undefined
    }
  }

  if (!securityPolicyMaybe?.success) {
    logger.error('Was unable to fetch security policy, bailing')
    process.exitCode = 1
    return {
      ok: false,
      scan: undefined,
      securityPolicy: undefined
    }
  }

  return {
    ok: true,
    scan,
    securityPolicy: securityPolicyMaybe
  }
}
