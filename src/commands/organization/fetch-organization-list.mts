/** @fileoverview Organization list API fetcher for Socket CLI. Retrieves list of organizations associated with Socket API token. Returns organization metadata including slugs, names, and plan details. */

import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { BaseFetchOptions, CResult } from '../../types.mts'
import type { SocketSdk, SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrganizationOptions = BaseFetchOptions & {
  description?: string | undefined
  sdk?: SocketSdk | undefined
}

export type EnterpriseOrganization = Omit<Organization, 'plan'> & {
  plan: `enterprise${string}`
}

export type EnterpriseOrganizations = EnterpriseOrganization[]

export type Organization =
  SocketSdkSuccessResult<'getOrganizations'>['data']['organizations'][string]

export type Organizations = Organization[]

export type OrganizationsData = { organizations: Organizations }

export type OrganizationsCResult = CResult<OrganizationsData>

export async function fetchOrganization(
  options?: FetchOrganizationOptions | undefined,
): Promise<OrganizationsCResult> {
  const {
    description = 'organization list',
    sdk,
    sdkOpts,
  } = {
    __proto__: null,
    ...options,
  } as FetchOrganizationOptions

  // Special case: if sdk is already provided, use it directly
  let sockSdk = sdk
  if (!sockSdk) {
    const sockSdkCResult = await setupSdk(sdkOpts)
    if (!sockSdkCResult.ok) {
      return sockSdkCResult
    }
    sockSdk = sockSdkCResult.data
  }

  const orgsCResult = await handleApiCall(sockSdk.getOrganizations(), {
    description,
  })
  if (!orgsCResult.ok) {
    return orgsCResult
  }

  return {
    ...orgsCResult,
    data: {
      organizations: Object.values(orgsCResult.data.organizations),
    },
  }
}