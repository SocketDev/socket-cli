import { isSupportedConfigKey } from '../../utils/config.mts'
import { hasDefaultToken } from '../../utils/sdk.mts'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'

export async function discoverConfigValue(
  key: string,
): Promise<CResult<unknown>> {
  // This will have to be a specific implementation per key because certain
  // keys should request information from particular API endpoints while
  // others should simply return their default value, like endpoint URL.

  if (key !== 'test' && !isSupportedConfigKey(key)) {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause: 'Requested key is not a valid config key.',
    }
  }

  if (key === 'apiBaseUrl') {
    // Return the default value
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        "If you're unsure about the base endpoint URL then simply unset it.",
    }
  }

  if (key === 'apiProxy') {
    // I don't think we can auto-discover this with any order of reliability..?
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        'When uncertain, unset this key. Otherwise ask your network administrator',
    }
  }

  if (key === 'apiToken') {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause:
        'You can find/create your API token in your Socket dashboard > settings > API tokens.\nYou should then use `socket login` to login instead of this command.',
    }
  }

  if (key === 'defaultOrg') {
    const hasApiToken = hasDefaultToken()
    if (!hasApiToken) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause:
          'No API token set, must have a token to resolve its default org.',
      }
    }

    const org = await getDefaultOrgFromToken()
    if (!org?.length) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause: 'Was unable to determine default org for the current API token.',
      }
    }

    if (Array.isArray(org)) {
      return {
        ok: true,
        data: org,
        message: 'These are the orgs that the current API token can access.',
      }
    }

    return {
      ok: true,
      data: org,
      message: 'This is the org that belongs to the current API token.',
    }
  }

  if (key === 'enforcedOrgs') {
    const hasApiToken = hasDefaultToken()
    if (!hasApiToken) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause:
          'No API token set, must have a token to resolve orgs to enforce.',
      }
    }

    const orgs = await getEnforceableOrgsFromToken()
    if (!orgs?.length) {
      return {
        ok: false,
        message: 'Auto discover failed',
        cause:
          'Was unable to determine any orgs to enforce for the current API token.',
      }
    }

    return {
      ok: true,
      data: orgs,
      message: 'These are the orgs whose security policy you can enforce.',
    }
  }

  if (key === 'test') {
    return {
      ok: false,
      message: 'Auto discover failed',
      cause: 'congrats, you found the test key',
    }
  }

  // Mostly to please TS, because we're not telling it `key` is keyof LocalConfig
  return {
    ok: false,
    message: 'Auto discover failed',
    cause: 'unreachable?',
  }
}

async function getDefaultOrgFromToken(): Promise<
  string[] | string | undefined
> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return undefined
  }

  const { organizations } = orgsCResult.data
  const slugs = Array.from(Object.values(organizations)).map(o => o.slug)
  if (slugs.length === 0) {
    return undefined
  }
  if (slugs.length === 1) {
    return slugs[0]
  }
  return slugs
}

async function getEnforceableOrgsFromToken(): Promise<string[] | undefined> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return undefined
  }

  const { organizations } = orgsCResult.data
  const slugs = Array.from(Object.values(organizations)).map(o => o.slug)
  if (!slugs.length) {
    return undefined
  }
  return slugs
}
