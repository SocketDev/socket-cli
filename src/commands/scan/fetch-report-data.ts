import colors from 'yoctocolors-cjs'

import { logger } from '@socketsecurity/registry/lib/logger'
import { SocketSdkResultType, SocketSdkReturnType } from '@socketsecurity/sdk'
import { components } from '@socketsecurity/sdk/types/api'

import constants from '../../constants'
import { handleAPIError, handleApiCall, queryAPI } from '../../utils/api'
import { AuthError } from '../../utils/errors'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

/**
 * This fetches all the relevant pieces of data to generate a report, given a
 * full scan ID.
 * It can optionally only fetch the security or license side of things.
 */
export async function fetchReportData(
  orgSlug: string,
  fullScanId: string,
  includeLicensePolicy: boolean,
  includeSecurityPolicy: boolean
): Promise<
  | {
      ok: true
      scan: Array<components['schemas']['SocketArtifact']>
      licensePolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>
      securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'>
    }
  | {
      ok: false
      scan: undefined
      licensePolicy: undefined
      securityPolicy: undefined
    }
> {
  let haveScan = false
  let haveLicensePolicy = false
  let haveSecurityPolicy = false

  // Lazily access constants.spinner.
  const { spinner } = constants

  function updateProgress() {
    const needs = [
      !haveScan ? 'scan' : undefined,
      includeLicensePolicy && !haveLicensePolicy ? 'license policy' : undefined,
      includeSecurityPolicy && !haveSecurityPolicy
        ? 'security policy'
        : undefined
    ].filter(Boolean)
    if (needs.length > 2) {
      // .toOxford()
      needs[needs.length - 1] = `and ${needs[needs.length - 1]}`
    }
    const haves = [
      haveScan ? 'scan' : undefined,
      includeLicensePolicy && haveLicensePolicy ? 'license policy' : undefined,
      includeSecurityPolicy && haveSecurityPolicy
        ? 'security policy'
        : undefined
    ].filter(Boolean)
    if (haves.length > 2) {
      // .toOxford()
      haves[haves.length - 1] = `and ${haves[haves.length - 1]}`
    }

    if (needs.length) {
      spinner.start(
        `Fetching ${needs.join(needs.length > 2 ? ', ' : ' and ')}...${haves.length ? ` Completed fetching ${haves.join(haves.length > 2 ? ', ' : ' and ')}.` : ''}`
      )
    } else {
      spinner?.successAndStop(
        `Completed fetching ${haves.join(haves.length > 2 ? ', ' : ' and ')}.`
      )
    }
  }

  const apiToken = getDefaultToken()
  if (!apiToken) {
    throw new AuthError(
      'User must be authenticated to run this command. To log in, run the command `socket login` and enter your API key.'
    )
  }

  updateProgress()

  const socketSdk = await setupSdk(apiToken)

  // @ts-ignore
  const [scan, licensePolicyMaybe, securityPolicyMaybe]: [
    undefined | Array<components['schemas']['SocketArtifact']>,
    undefined | SocketSdkResultType<'getOrgSecurityPolicy'>,
    undefined | SocketSdkResultType<'getOrgSecurityPolicy'>
  ] = await Promise.all([
    (async () => {
      try {
        const response = await queryAPI(
          `orgs/${orgSlug}/full-scans/${encodeURIComponent(fullScanId)}`,
          apiToken
        )

        haveScan = true
        updateProgress()

        if (!response.ok) {
          const err = await handleAPIError(response.status)
          logger.fail(
            `${colors.bgRed(colors.white(response.statusText))}: Fetch error: ${err}`
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
          'There was an issue while fetching full scan data.'
        )
        throw e
      }
    })(),
    includeLicensePolicy &&
      (async () => {
        const r = await socketSdk.getOrgSecurityPolicy(orgSlug)
        haveLicensePolicy = true
        updateProgress()
        return await handleApiCall(
          r,
          "looking up organization's license policy"
        )
      })(),
    includeSecurityPolicy &&
      (async () => {
        const r = await socketSdk.getOrgSecurityPolicy(orgSlug)
        haveSecurityPolicy = true
        updateProgress()
        return await handleApiCall(
          r,
          "looking up organization's security policy"
        )
      })()
  ]).finally(() => spinner.stop())

  if (!Array.isArray(scan)) {
    logger.error('Was unable to fetch scan, bailing')
    process.exitCode = 1
    return {
      ok: false,
      scan: undefined,
      licensePolicy: undefined,
      securityPolicy: undefined
    }
  }

  // Note: security->license once the api ships in the sdk
  let licensePolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'> =
    undefined
  if (includeLicensePolicy) {
    if (licensePolicyMaybe && licensePolicyMaybe.success) {
      licensePolicy = licensePolicyMaybe
    } else {
      logger.error('Was unable to fetch license policy, bailing')
      process.exitCode = 1
      return {
        ok: false,
        scan: undefined,
        licensePolicy: undefined,
        securityPolicy: undefined
      }
    }
  }

  let securityPolicy: undefined | SocketSdkReturnType<'getOrgSecurityPolicy'> =
    undefined
  if (includeSecurityPolicy) {
    if (securityPolicyMaybe && securityPolicyMaybe.success) {
      securityPolicy = securityPolicyMaybe
    } else {
      logger.error('Was unable to fetch security policy, bailing')
      process.exitCode = 1
      return {
        ok: false,
        scan: undefined,
        licensePolicy: undefined,
        securityPolicy: undefined
      }
    }
  }

  return { ok: true, scan, licensePolicy, securityPolicy }
}
