import { handleApiCall } from '../../utils/api.mts'
import { setupSdk } from '../../utils/sdk.mts'

import type { CResult } from '../../types.mts'
import type { SetupSdkOptions } from '../../utils/sdk.mts'

export type FetchLicensePolicyOptions = {
  sdkOpts?: SetupSdkOptions | undefined
}

// Type expected by output modules
export interface LicensePolicyResult {
  rules: Array<{
    license: string
    action: 'allow' | 'deny' | 'warn'
  }>
  defaultAction: 'allow' | 'deny'
}

export async function fetchLicensePolicy(
  orgSlug: string,
  options?: FetchLicensePolicyOptions | undefined,
): Promise<CResult<LicensePolicyResult>> {
  const { sdkOpts } = {
    __proto__: null,
    ...options,
  } as FetchLicensePolicyOptions

  const sockSdkCResult = await setupSdk(sdkOpts)
  if (!sockSdkCResult.ok) {
    return sockSdkCResult
  }
  const sockSdk = sockSdkCResult.data

  const apiResult = await handleApiCall(sockSdk.getOrgLicensePolicy(orgSlug), {
    description: 'organization license policy',
  })

  if (!apiResult.ok) {
    return apiResult
  }

  // Transform API response to expected format
  const rules: LicensePolicyResult['rules'] = []
  let defaultAction: LicensePolicyResult['defaultAction'] = 'allow'

  // The API returns an object with dynamic properties
  // We need to extract the rules and default action
  const policyData = apiResult.data

  if (policyData) {
    // Check for a default action property
    if ('defaultAction' in policyData) {
      const action = policyData['defaultAction']
      if (action === 'deny' || action === 'allow') {
        defaultAction = action
      }
    }

    // Extract license rules from the remaining properties
    const rulesData = policyData['rules'] as unknown
    if (rulesData && Array.isArray(rulesData)) {
      // If rules is already an array
      for (const rule of rulesData) {
        if (rule && typeof rule === 'object' && 'license' in rule && 'action' in rule) {
          rules.push({
            license: String(rule.license),
            action: rule.action as 'allow' | 'deny' | 'warn',
          })
        }
      }
    } else {
      // Otherwise, treat other properties as license rules
      for (const [key, value] of Object.entries(policyData)) {
        if (key !== 'defaultAction' && typeof value === 'string') {
          // Assume key is license and value is action
          rules.push({
            license: key,
            action: value as 'allow' | 'deny' | 'warn',
          })
        }
      }
    }
  }

  const transformed: LicensePolicyResult = {
    rules,
    defaultAction,
  }

  return {
    ok: true,
    data: transformed,
  }
}