import { handleApiCall } from '../../utils/socket/api.mjs'
import { setupSdk } from '../../utils/socket/sdk.mjs'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/socket/sdk.mjs'
import type { SocketSdk, SocketSdkSuccessResult } from '@socketsecurity/sdk'

export type FetchOrganizationOptions = {
  description?: string | undefined
  sdk?: SocketSdk | undefined
  sdkOpts?: SetupSdkOptions | undefined
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

  let sockSdk = sdk
  if (!sockSdk) {
    const sockSdkCResult = await setupSdk(sdkOpts)
    if (!sockSdkCResult.ok) {
      return sockSdkCResult
    }
    sockSdk = sockSdkCResult.data
  }

  const orgsCResult = await handleApiCall(sockSdk.listOrganizations(), {
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
