import { isSupportedConfigKey } from '../../util/config.mts'
import { getOrgSlugs } from '../../util/organization.mts'
import { hasDefaultApiToken } from '../../util/socket/sdk.mjs'
import { fetchOrganization } from '../organization/fetch-organization-list.mts'

import type { CResult } from '../../types.mts'

const AUTO_DISCOVER_FAILED = 'Auto discover failed'

export async function discoverConfigValue(
  key: string,
): Promise<CResult<unknown>> {
  // This will have to be a specific implementation per key because certain
  // keys should request information from particular API endpoints while
  // others should simply return their default value, like endpoint URL.

  if (key !== 'test' && !isSupportedConfigKey(key)) {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause: 'Requested key is not a valid config key.',
    }
  }

  if (key === 'apiBaseUrl') {
    // Return the default value
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause:
        "If you're unsure about the base endpoint URL then simply unset it.",
    }
  }

  if (key === 'apiProxy') {
    // I don't think we can auto-discover this with any order of reliability..?
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause:
        'When uncertain, unset this key. Otherwise ask your network administrator',
    }
  }

  if (key === 'apiToken') {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause:
        'You can find/create your API token in your Socket dashboard > settings > API tokens.\nYou should then use `socket login` to login instead of this command.',
    }
  }

  if (key === 'defaultOrg') {
    return await discoverDefaultOrg()
  }

  if (key === 'enforcedOrgs') {
    return await discoverEnforcedOrgs()
  }

  if (key === 'test') {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause: 'congrats, you found the test key',
    }
  }

  // Mostly to please TS, because we're not telling it `key` is keyof LocalConfig
  return {
    ok: false,
    message: AUTO_DISCOVER_FAILED,
    cause: 'unreachable?',
  }
}

export async function discoverDefaultOrg(): Promise<CResult<unknown>> {
  if (!hasDefaultApiToken()) {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause: 'No API token set, must have a token to resolve its default org.',
    }
  }
  const org = await getDefaultOrgFromToken()
  if (!org?.length) {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause: 'Was unable to determine default org for the current API token.',
    }
  }
  return {
    ok: true,
    data: org,
    message: Array.isArray(org)
      ? 'These are the orgs that the current API token can access.'
      : 'This is the org that belongs to the current API token.',
  }
}

export async function discoverEnforcedOrgs(): Promise<CResult<unknown>> {
  if (!hasDefaultApiToken()) {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
      cause: 'No API token set, must have a token to resolve orgs to enforce.',
    }
  }
  const orgs = await getEnforceableOrgsFromToken()
  if (!orgs?.length) {
    return {
      ok: false,
      message: AUTO_DISCOVER_FAILED,
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

export async function getDefaultOrgFromToken(): Promise<
  string[] | string | undefined
> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return undefined
  }

  const { organizations } = orgsCResult.data
  if (!organizations.length) {
    return undefined
  }
  const slugs = getOrgSlugs(organizations)
  if (slugs.length === 1) {
    return slugs[0]
  }
  return slugs
}

export async function getEnforceableOrgsFromToken(): Promise<
  string[] | undefined
> {
  const orgsCResult = await fetchOrganization()
  if (!orgsCResult.ok) {
    return undefined
  }

  const { organizations } = orgsCResult.data
  return organizations.length ? getOrgSlugs(organizations) : undefined
}
