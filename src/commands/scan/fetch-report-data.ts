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
      securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>
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

  let haveScan = false
  let haveSecurityPolicy = false

  // Lazily access constants.spinner.
  const { spinner } = constants

  function updateProgress() {
    const needs = [
      !haveScan ? 'scan' : undefined,
      !haveSecurityPolicy ? 'security policy' : undefined
    ].filter(Boolean)
    const haves = [
      haveScan ? 'scan' : undefined,
      haveSecurityPolicy ? 'security policy' : undefined
    ].filter(Boolean)

    if (needs.length) {
      spinner.start(
        `Fetching ${needs.join(' and ')}...${haves.length ? ` Completed fetching ${haves.join(' and ')}.` : ''}`
      )
    } else {
      spinner.successAndStop(`Completed fetching ${haves.join(' and ')}.`)
    }
  }

  updateProgress()

  const [scan, securityPolicyMaybe]: [
    undefined | Array<components['schemas']['SocketArtifact']>,
    SocketSdkResultType<'getOrgSecurityPolicy'>
  ] = await Promise.all([
    (async () => {
      try {
        const response = await queryApi(
          `orgs/${orgSlug}/full-scans/${encodeURIComponent(scanId)}${includeLicensePolicy ? '?include_license_details=true' : ''}`,
          apiToken
        )

        haveScan = true
        updateProgress()

        if (!response.ok) {
          const err = await handleApiError(response.status)
          logger.fail(
            failMsgWithBadge(response.statusText, `Fetch error: ${err}`)
          )
          return undefined
        }

        const jsons = await response.text()
        const lines = jsons.split('\n').filter(Boolean)
        const data = lines.map(line => {
          try {
            return JSON.parse(line)
          } catch {
            console.error(
              'At least one line item was returned that could not be parsed as JSON...'
            )
            return
          }
        }) as unknown as Array<components['schemas']['SocketArtifact']>

        return data
      } catch (e) {
        spinner.errorAndStop(
          'There was an issue while fetching full scan data'
        )
        throw e
      }
    })(),
    (async () => {
      const r = await sockSdk.getOrgSecurityPolicy(orgSlug)
      haveSecurityPolicy = true
      updateProgress()
      return await handleApiCall(r, "looking up organization's security policy")
    })()
  ]).finally(() => spinner.stop())

  if (!Array.isArray(scan)) {
    logger.error('Was unable to fetch scan, bailing')
    process.exitCode = 1
    return {
      ok: false,
      scan: undefined,
      securityPolicy: undefined
    }
  }

  let securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'> =
    undefined
  if (securityPolicyMaybe && securityPolicyMaybe.success) {
    securityPolicy = securityPolicyMaybe
  } else {
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
    securityPolicy
  }
}
