import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'
import type { SocketSdk, SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrganizationOptions = {
  description?: string | undefined
  sdk?: SocketSdk | undefined
  sdkOpts?: SetupSdkOptions | undefined
}

export type EnterpriseOrganization = Omit<Organization, 'plan'> & {
  plan: 'enterprise'
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
