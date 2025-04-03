import { handleApiCall } from '../../utils/api'
import { supportedConfigKeys } from '../../utils/config'
import { getDefaultToken, setupSdk } from '../../utils/sdk'

import type { LocalConfig } from '../../utils/config'

export async function discoverConfigValue(
  key: string
): Promise<{ success: boolean; value: unknown; message: string }> {
  // This will have to be a specific implementation per key because certain
  // keys should request information from particular API endpoints while
  // others should simply return their default value, like endpoint URL.

  if (!supportedConfigKeys.has(key as keyof LocalConfig)) {
    return {
      success: false,
      value: undefined,
      message: 'Requested key is not a valid config key.'
    }
  }

  if (key === 'apiBaseUrl') {
    // Return the default value
    return {
      success: false,
      value: undefined,
      message:
        "If you're unsure about the base endpoint URL then simply unset it."
    }
  }

  if (key === 'apiProxy') {
    // I don't think we can auto-discover this with any order of reliability..?
    return {
      success: false,
      value: undefined,
      message:
        'When uncertain, unset this key. Otherwise ask your network administrator'
    }
  }

  if (key === 'apiToken') {
    return {
      success: false,
      value: undefined,
      message:
        'You can find/create your API token in your Socket dashboard > settings > API tokens.\nYou should then use `socket login` to login instead of this command.'
    }
  }

  if (key === 'defaultOrg') {
    const apiToken = getDefaultToken()
    if (!apiToken) {
      return {
        success: false,
        value: undefined,
        message:
          'No API token set, must have a token to resolve its default org.'
      }
    }

    const org = await getDefaultOrgFromToken()
    if (!org?.length) {
      return {
        success: false,
        value: undefined,
        message:
          'Was unable to determine default org for the current API token.'
      }
    }

    if (Array.isArray(org)) {
      return {
        success: true,
        value: org,
        message: 'These are the orgs that the current API token can access.'
      }
    }

    return {
      success: true,
      value: org,
      message: 'This is the org that belongs to the current API token.'
    }
  }

  if (key === 'enforcedOrgs') {
    const apiToken = getDefaultToken()
    if (!apiToken) {
      return {
        success: false,
        value: undefined,
        message:
          'No API token set, must have a token to resolve orgs to enforce.'
      }
    }

    const orgs = await getEnforceableOrgsFromToken()
    if (!orgs?.length) {
      return {
        success: false,
        value: undefined,
        message:
          'Was unable to determine any orgs to enforce for the current API token.'
      }
    }

    return {
      success: true,
      value: orgs,
      message: 'These are the orgs whose security policy you can enforce.'
    }
  }

  if (key === 'test') {
    return {
      success: false,
      value: undefined,
      message: ''
    }
  }

  // Mostly to please TS, because we're not telling it `key` is keyof LocalConfig
  return {
    success: false,
    value: undefined,
    message: 'unreachable?'
  }
}

async function getDefaultOrgFromToken(): Promise<
  string[] | string | undefined
> {
  const sockSdk = await setupSdk()
  const result = await handleApiCall(
    sockSdk.getOrganizations(),
    'looking up organizations'
  )

  if (result.success) {
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
    'looking up organizations'
  )

  if (result.success) {
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
