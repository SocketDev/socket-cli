import { handleApiCall } from '../../utils/api.mts'
import { supportedConfigKeys } from '../../utils/config.mts'
import { getDefaultToken, setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { LocalConfig } from '../../utils/config.mts'

export async function discoverConfigValue(
  key: string
): Promise<CResult<unknown>> {
  // This will have to be a specific implementation per key because certain
  // keys should request information from particular API endpoints while
  // others should simply return their default value, like endpoint URL.

  if (!supportedConfigKeys.has(key as keyof LocalConfig)) {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause: 'Requested key is not a valid config key.'
    }
  }

  if (key === 'apiBaseUrl') {
    // Return the default value
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        "If you're unsure about the base endpoint URL then simply unset it."
    }
  }

  if (key === 'apiProxy') {
    // I don't think we can auto-discover this with any order of reliability..?
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        'When uncertain, unset this key. Otherwise ask your network administrator'
    }
  }

  if (key === 'apiToken') {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        'You can find/create your API token in your Socket dashboard > settings > API tokens.\nYou should then use `socket login` to login instead of this command.'
    }
  }

  if (key === 'defaultOrg') {
    const apiToken = getDefaultToken()
    if (!apiToken) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause: 'No API token set, must have a token to resolve its default org.'
      }
    }

    const org = await getDefaultOrgFromToken()
    if (!org?.length) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause: 'Was unable to determine default org for the current API token.'
      }
    }

    if (Array.isArray(org)) {
      return {
        ok: true,
        data: org,
        message: 'These are the orgs that the current API token can access.'
      }
    }

    return {
      ok: true,
      data: org,
      message: 'This is the org that belongs to the current API token.'
    }
  }

  if (key === 'enforcedOrgs') {
    const apiToken = getDefaultToken()
    if (!apiToken) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause: 'No API token set, must have a token to resolve orgs to enforce.'
      }
    }

    const orgs = await getEnforceableOrgsFromToken()
    if (!orgs?.length) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause:
          'Was unable to determine any orgs to enforce for the current API token.'
      }
    }

    return {
      ok: true,
      data: orgs,
      message: 'These are the orgs whose security policy you can enforce.'
    }
  }

  if (key === 'test') {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause: 'congrats, you found the test key'
    }
  }

  // Mostly to please TS, because we're not telling it `key` is keyof LocalConfig
  return {
    ok: false,
    message: 'Auto discover failed',
    cause: 'unreachable?'
  }
}

async function getDefaultOrgFromToken(): Promise<
  string[] | string | undefined
> {
  const sockSdk = await setupSdk()

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'Requesting list of organizations...',
    'Received API response (requested list of organizations).',
    'Error fetching list of organizations',
    'getOrganizations'
  )

  if (result.ok) {
    const arr = Array.from(Object.values(result.data.organizations)).map(
      ({ slug }) => slug
    )
    if (arr.length === 0) {
      return undefined
    }
    if (arr.length === 1) {
      return arr[0]
    }
    return arr
  }

  return undefined
}

async function getEnforceableOrgsFromToken(): Promise<string[] | undefined> {
  const sockSdk = await setupSdk()

  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'Requesting list of organizations...',
    'Received API response (requested list of organizations).',
    'Error fetching list of organizations',
    'getOrganizations'
  )

  if (result.ok) {
    const arr = Array.from(Object.values(result.data.organizations)).map(
      ({ slug }) => slug
    )
    if (arr.length === 0) {
      return undefined
    }
    return arr
  }

  return undefined
}
